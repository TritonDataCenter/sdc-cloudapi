/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var util = require('util');
var test = require('tape').test;
var common = require('./common');
var uuid = common.uuid;
var machinesCommon = require('./machines/common');
var checkMachine = machinesCommon.checkMachine;


// --- Globals


var SDC_128 = common.sdc_128_package;

var IMAGE_UUID;
var SERVER_UUID;
var PROVISIONABLE_NET_UUID;
var MACHINE_UUID;

var CLIENTS;
var CLIENT;
var OTHER;
var SERVER;


// --- Helpers


/**
 * Provision a machine with an invalid network and check the error message
 */
function provisionWithInvalidNetwork(t, networks, errMessage) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_128.name,
        name: 'a' + uuid().substr(0, 7),
        networks: networks,
        server_uuid: SERVER_UUID
    };

    CLIENT.post({
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
    common.setup({clientApiVersion: '~7.3'}, function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        OTHER   = clients.other;
        SERVER  = server;

        t.end();
    });
});


test('Get test server', function (t) {
    common.getTestServer(CLIENT, function (err, testServer) {
        t.ifError(err);
        SERVER_UUID = testServer.uuid;
        t.end();
    });
});


test('Get test image', function (t) {
    common.getTestImage(CLIENT, function (err, img) {
        t.ifError(err, 'getTestImage');
        t.ok(img.id, 'img.id: ' + img.id);
        IMAGE_UUID = img.id;
        t.end();
    });
});


test('get provisionable network', function (t) {
    machinesCommon.getProvisionableNetwork(CLIENT, function (err, net) {
        t.ifError(err);

        if (net) {
            PROVISIONABLE_NET_UUID = net.id;
            t.ok(net.id, 'net id: ' + net.id);
        }

        t.end();
    });
});


test('CreateMachine: new networks format', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_128.name,
        name: 'a' + uuid().substr(0, 7),
        networks: [ {
            ipv4_uuid: PROVISIONABLE_NET_UUID
        } ],
        server_uuid: SERVER_UUID
    };

    machinesCommon.createMachine(t, CLIENT, obj, function (_, machineUuid) {
        MACHINE_UUID = machineUuid;
        t.end();
    });
});


test('Wait For Running', function (t) {
    machinesCommon.waitForRunningMachine(CLIENT, MACHINE_UUID, function (err) {
        t.ifError(err);

        if (err) {
            // Skip machine tests when machine creation fails
            MACHINE_UUID = false;
        }

        t.end();
    });
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
            { ipv4_uuid: PROVISIONABLE_NET_UUID, ipv4_count: 'a' }
        ], 'Invalid VM parameters: Invalid networks');
    });


    tt.test('ipv4_count: wrong type', function (t) {
        provisionWithInvalidNetwork(t, [
            { ipv4_uuid: PROVISIONABLE_NET_UUID, ipv4_count: 2 }
        ], 'Invalid VM parameters: Invalid networks');
    });

});


test('Delete tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
