/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Provision Limits tests.
 *
 * This file defines optional test cases to run only when there is some
 * interest into enabling this plugin. Otherwise, these tests can be
 * perfectly ignored and the plugin should be disabled to skip some
 * unnecessary checks during each provision request.
 */

var test = require('tape').test;

var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var util = require('util');
var common = require('./common');
var machinesCommon = require('./machines/common');
var checkMachine = machinesCommon.checkMachine;
var checkJob = machinesCommon.checkJob;
var waitForJob = machinesCommon.waitForJob;
var checkWfJob = machinesCommon.checkWfJob;
var waitForWfJob = machinesCommon.waitForWfJob;
var saveKey = machinesCommon.saveKey;
var addPackage = machinesCommon.addPackage;

var plugin = require('../plugins/provision_limits'),
    filterLimits = plugin.filterLimits;

// --- Globals

var client, server;
var cfg = common.getCfg();
var DC_NAME = Object.keys(cfg.datacenters)[0];

// Will override configuration before we go ahead with plugin testing:
cfg.plugins = [ {
    name: 'provision_limits',
    enabled: true,
    config: {
        datacenter: DC_NAME,
        defaults: [ {
            image: 'any',
            check: 'image',
            by: 'ram',
            value: 512
        }, {
            os: 'windows',
            image: 'windows',
            check: 'image',
            by: 'machines',
            value: -1
        } ]
    }
}];


var KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEAvad19ePSDckmgmo6Unqmd8' +
    'n2G7o1794VN3FazVhV09yooXIuUhA+7OmT7ChiHueayxSubgL2MrO/HvvF/GGVUs/t3e0u4' +
    '5YwRC51EVhyDuqthVJWjKrYxgDMbHru8fc1oV51l0bKdmvmJWbA/VyeJvstoX+eiSGT3Jge' +
    'egSMVtc= mark@foo.local';
var keyName = uuid();

var machine, machine2;
var sdc_128_ok_entry;
var sdc_128_ok = {
    uuid: '897779dc-9ce7-4042-8879-a4adccc94353',
    name: 'sdc_128_ok',
    version: '1.0.0',
    max_physical_memory: 128,
    quota: 10240,
    max_swap: 512,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    fss: 25,
    'default': false,
    vcpus: 1,
    active: true
};

var HEADNODE = null;
var DATASET, IMAGE;

// --- Helpers:


function createLimit(t, cb) {
    return client.ufds.getUser(client.testUser, function (err, user) {
        t.ifError(err, 'client.getUser error');

        var limit = {
            datacenter: DC_NAME,
            base: 2,
            limit: [
                JSON.stringify({
                    os: 'smartos',
                    check: 'os',
                    by: 'ram',
                    value: '8192'
                }),
                JSON.stringify({
                    image: 'nodejs',
                    check: 'image',
                    by: 'machines',
                    value: '-1'
                }),
                JSON.stringify({
                    os: 'any',
                    check: 'os',
                    by: 'machines',
                    value: '4'
                })
            ]
        };
        return user.addLimit(limit, function (er2, limits) {
            t.ifError(er2, 'createLimit error');
            return cb();
        });
    });
}

// --- Tests

test('setup', function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);
        client = _client;
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
        }
        server = _server;
        saveKey(KEY, keyName, client, t, function () {
            // Add custom packages; "sdc_" ones will be owned by admin user:
            addPackage(client, sdc_128_ok, function (err2, entry) {
                t.ifError(err2, 'Add package error');
                sdc_128_ok_entry = entry;
                createLimit(t, function () {
                    t.end();
                });
            });
        });
        createLimit(t, function () {
            t.end();
        });
    });
});


test('Get Headnode', function (t) {
    client.cnapi.listServers(function (err, servers) {
        t.ifError(err);
        t.ok(servers);
        t.ok(Array.isArray(servers));
        t.ok(servers.length > 0);
        servers = servers.filter(function (s) {
            return (s.headnode);
        });
        t.ok(servers.length > 0);
        HEADNODE = servers[0];
        t.ok(HEADNODE);
        t.end();
    });
});


test('get base dataset', function (t) {
    client.get('/my/datasets?name=base', function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets error');
        t.equal(res.statusCode, 200, 'GET /my/datasets status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets body');
        t.ok(Array.isArray(body), 'GET /my/datasets body is an array');
        t.ok(body.length, 'GET /my/datasets body array has elements');
        body.forEach(function (d) {
            if (d.version && d.version === '13.3.0') {
                DATASET = body[0].id;
                IMAGE = body[0];
            }
        });
        t.end();
    });
});


// Isolated tests to the function which decides which limits will be applied
// given cloudapi cfg, customer limits and the requested image
test('filterLimits', function (t) {

    // Our tests will be based into the same image we will use later:
    t.ok(IMAGE, 'filterLimits Image');
    t.equal(IMAGE.os, 'smartos', 'filterLimits Image OS');
    t.equal(IMAGE.name, 'base', 'filterLimits Image name');

    t.test('customer catch-all by os', function (t2) {
        // Only the customer specific limit will be applied:
        var limits = [];
        limits.push({ limit: [JSON.stringify({
            check: 'os',
            os: 'any',
            by: 'machines',
            value: 2
        })]});

        var cfg_limits = [ {
            check: 'os',
            os: 'smartos',
            by: 'machines',
            value: 4
        }];
        var applied = filterLimits(IMAGE, cfg_limits, limits);
        t2.equal(applied.length, 1, 'customer catch-all os');
        t2.equal(applied[0].value, 2, 'customer catch-all os val');
        t2.end();
    });

    t.test('customer catch-all by image', function (t2) {
        // Only the customer specific limit will be applied:
        var limits = [];
        limits.push({ limit: [JSON.stringify({
            check: 'image',
            image: 'any',
            by: 'machines',
            value: 2
        })]});
        var cfg_limits = [ {
            check: 'image',
            image: 'base',
            by: 'machines',
            value: 4
        }];
        var applied = filterLimits(IMAGE, cfg_limits, limits);
        t2.equal(applied.length, 1);
        t2.equal(applied[0].value, 2);
        t2.end();
    });

    t.test('global catch-all by os', function (t2) {
        var cfg_limits = [ {
            check: 'os',
            os: 'any',
            by: 'machines',
            value: 4
        }];

        // It will not be applied when there is a specific customer limit:
        var limits = [];
        limits.push({ limit: [JSON.stringify({
            check: 'os',
            os: 'smartos',
            by: 'machines',
            value: 10
        })]});
        var applied = filterLimits(IMAGE, cfg_limits, limits);
        t2.equal(applied.length, 1);
        t2.equal(applied[0].value, 10);
        // But it will be when there is not specific limit:
        applied = filterLimits(IMAGE, cfg_limits, []);
        t2.equal(applied.length, 1);
        t2.equal(applied[0].value, 4);
        t2.end();
    });

    t.test('global catch-all by image', function (t2) {
        var cfg_limits = [ {
            check: 'image',
            image: 'any',
            by: 'machines',
            value: 4
        }];

        // It will not be applied when there is a specific customer limit:
        var limits = [];
        limits.push({ limit: [JSON.stringify({
            check: 'image',
            image: 'base',
            by: 'machines',
            value: 10
        })]});
        var applied = filterLimits(IMAGE, cfg_limits, limits);
        t2.equal(applied.length, 1, 'global image length');
        t2.equal(applied[0].value, 10, 'global image value');
        // But it will be when there is not specific limit:
        applied = filterLimits(IMAGE, cfg_limits, []);
        t2.equal(applied.length, 1, 'global image length (no local)');
        t2.equal(applied[0].value, 4, 'global image val (no local)');
        t2.end();

    });
    t.end();
});


test('CreateMachine', function (t) {
    var obj = {
        image: DATASET,
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid,
        firewall_enabled: true
    };

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ifError(err, 'POST /my/machines error');
        t.equal(res.statusCode, 201, 'POST /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'POST /my/machines body');
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


test('CreateMachine #2', function (t) {
    var obj = {
        image: DATASET,
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid,
        firewall_enabled: true
    };

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ifError(err, 'POST /my/machines error');
        t.equal(res.statusCode, 201, 'POST /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'POST /my/machines body');
        machine2 = body.id;
        // Handy to output this to stdout in order to poke around COAL:
        console.log('Requested provision of machine: %s', machine2);
        t.end();
    });
});


test('Wait For Running #2', function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine2,
        task: 'provision'
    }, function (err, jobs) {
        if (err) {
            // Skip machine tests when machine creation fails
            machine2 = null;
        }
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs ok');
        t.ok(jobs.length, 'list jobs is an array');
        waitForJob(client, jobs[0].uuid, function (err2) {
            if (err2) {
                // Skip machine tests when machine creation fails
                machine2 = null;
            }
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});

// This should fail due to limits:
test('CreateMachine #3', function (t) {
    var obj = {
        image: DATASET,
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid,
        firewall_enabled: true
    };

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err, 'Create machine #3 error');
        // Otherwise, it'll complain about 'cannot read property of null':
        if (err) {
            t.ok(/QuotaExceeded/.test(err.message));
            t.equal(res.statusCode, 403, 'create machine w/o dataset status');
        }
        t.end();
    });
});




test('Delete tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, client, machine, function () {
        t.end();
    });
});


test('Delete tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, client, machine2, function () {
        t.end();
    });
});


test('teardown', function (t) {
    client.del('/my/keys/' + keyName, function (err, req, res) {
        t.ifError(err, 'delete key error');
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        client.teardown(function (err2) {
            // Ignore err2 here, just means we have not been able to remove
            // something from ufds.
            if (!process.env.SDC_SETUP_TESTS) {
                Object.keys(server._clients).forEach(function (c) {
                    if (typeof (server._clients[c].client) !== 'undefined' &&
                        typeof (server._clients[c].client.close) ===
                            'function') {
                        server._clients[c].client.close();
                        }
                });
                server._clients.ufds.client.removeAllListeners('close');
                server.close(function () {
                    t.end();
                });
            } else {
                t.end();
            }
        });
    });
});
