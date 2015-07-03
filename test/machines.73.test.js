/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var fs = require('fs');
var util = require('util');
var test = require('tape').test;
var restify = require('restify');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var sprintf = util.format;
var common = require('./common'),
    checkMahiCache = common.checkMahiCache,
    waitForMahiCache = common.waitForMahiCache;
var setup = require('./setup');
var machinesCommon = require('./machines/common');
var checkMachine = machinesCommon.checkMachine;
var checkJob = machinesCommon.checkJob;
var waitForJob = machinesCommon.waitForJob;
var checkWfJob = machinesCommon.checkWfJob;
var waitForWfJob = machinesCommon.waitForWfJob;
var saveKey = machinesCommon.saveKey;
var addPackage = machinesCommon.addPackage;
// --- Globals

var client, server;
var keyName = uuid();
var machine;
var KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEAvad19ePSDckmgmo6Unqmd8' +
    'n2G7o1794VN3FazVhV09yooXIuUhA+7OmT7ChiHueayxSubgL2MrO/HvvF/GGVUs/t3e0u4' +
    '5YwRC51EVhyDuqthVJWjKrYxgDMbHru8fc1oV51l0bKdmvmJWbA/VyeJvstoX+eiSGT3Jge' +
    'egSMVtc= mark@foo.local';


var sdc_256_inactive_entry, sdc_128_ok_entry;

var DATASET;
var HEADNODE = null;
var PROVISIONABLE_NET;


// --- Internal



/**
 * Provision a machine with an invalid network and check the error message
 */
function provisionWithInvalidNetwork(t, networks, errMessage) {
    var obj = {
        image: DATASET,
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        networks: networks,
        server_uuid: HEADNODE.uuid
    };

    client.post({
        path: '/my/machines'
    }, obj, function (err, req, res, body) {
        t.ok(err, 'error expected');
        if (err) {
            t.equal(err.message, errMessage, 'error message');
        }

        t.end();
    });
}



// --- Tests



test('setup', function (t) {
    common.setup('~7.3', function (err, _client, _server) {
        t.ifError(err, 'common setup error');
        t.ok(_client, 'common _client ok');

        client = _client;
        server = _server;

        saveKey(KEY, keyName, client, t, function () {
            // Add custom packages; "sdc_" ones will be owned by admin user:
            addPackage(client, setup.packages.sdc_128_ok,
                    function (err2, entry) {
                t.ifError(err2, 'Add package error');
                sdc_128_ok_entry = entry;

                addPackage(client, setup.packages.sdc_256_inactive,
                        function (err3, entry2) {
                    t.ifError(err3, 'Add package error');
                    sdc_256_inactive_entry = entry2;

                    t.end();
                });
            });
        });
    });
});


test('Get Headnode', function (t) {
    setup.getHeadnode(t, client, function (hn) {
        HEADNODE = hn;
        t.end();
    });
});


test('get base dataset', function (t) {
    setup.getBaseDataset(t, client, function (dataset) {
        DATASET = dataset;
        t.end();
    });
});


test('get provisionable network', function (t) {
    setup.getProvisionableNetwork(t, client, function (net) {
        PROVISIONABLE_NET = net;
        if (net) {
            t.ok(net.id, 'net id: ' + net.id);
        }

        t.end();
    });
});


test('CreateMachine: new networks format', function (t) {
    var obj = {
        image: DATASET,
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        networks: [ {
            ipv4_uuid: PROVISIONABLE_NET.id
        } ],
        server_uuid: HEADNODE.uuid
    };

    client.post({
        path: '/my/machines'
    }, obj, function (err, req, res, body) {
        t.ifError(err, 'POST /my/machines error');
        t.equal(res.statusCode, 201, 'POST /my/machines status');
        common.checkHeaders(t, res.headers);
        common.checkReqId(t, res.headers);
        t.equal(res.headers.location,
            util.format('/%s/machines/%s', client.testUser, body.id));
        t.ok(body, 'POST /my/machines body');
        checkMachine(t, body);
        machine = body.id;
        // Handy to output this to stdout in order to poke around COAL:
        console.log('Requested provision of machine: %s', machine);
        t.end();
    });
});


test('Wait For Running', function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'provision'
    }, function (err, jobs) {
        if (err) {
            // Skip machine tests when machine creation fails
            machine = null;
        }
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs ok');
        t.ok(jobs.length, 'list jobs is an array');
        waitForJob(client, jobs[0].uuid, function (err2) {
            if (err2) {
                // Skip machine tests when machine creation fails
                machine = null;
            }
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('Get Machine', function (t) {
    if (machine) {
        client.get({
            path: '/my/machines/' + machine
        }, function (err, req, res, body) {
            t.ifError(err, 'GET /my/machines/:id error');
            t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
            common.checkHeaders(t, res.headers);
            common.checkReqId(t, res.headers);
            t.ok(body, 'GET /my/machines/:id body');
            checkMachine(t, body);
            t.ok(body.networks, 'machine networks');
            t.ok(Array.isArray(body.networks), 'machine networks array');

            t.end();
        });
    }
});


test('networks: invalid formats', function (tt) {

    tt.test('ipv4_uuid: not a UUID', function (t) {
        provisionWithInvalidNetwork(t, [
            { ipv4_uuid: 'asdf' }
        ], 'Invalid Networks');
    });


    tt.test('ipv4_uuid: wrong type', function (t) {
        provisionWithInvalidNetwork(t, [
            { ipv4_uuid: {} }
        ], 'property "networks[0].ipv4_uuid": string expected');
    });


    tt.test('ipv4_count: wrong type', function (t) {
        provisionWithInvalidNetwork(t, [
            { ipv4_uuid: PROVISIONABLE_NET.id, ipv4_count: 'a' }
        ], 'Invalid VM parameters: Invalid networks');
    });


    tt.test('ipv4_count: wrong type', function (t) {
        provisionWithInvalidNetwork(t, [
            { ipv4_uuid: PROVISIONABLE_NET.id, ipv4_count: 2 }
        ], 'Invalid VM parameters: Invalid networks');
    });

});


test('Delete tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, client, machine, function () {
        t.end();
    });
});


test('teardown', function (t) {
    client.del('/my/keys/' + keyName, function (err, req, res) {
        t.ifError(err, 'delete key error');
        t.equal(res.statusCode, 204);

        common.teardown(client, server, function () {
            t.end();
        });
    });
});
