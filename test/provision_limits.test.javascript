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
var common = require('./common');
var uuid = common.uuid;
var machinesCommon = require('./machines/common');

var filterLimits = require('../plugins/provision_limits').filterLimits;


// --- Globals


var CFG = common.getCfg();
var DC_NAME = Object.keys(CFG.datacenters)[0];

// Will override configuration before we go ahead with plugin testing:
CFG.plugins = [ {
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

var SDC_128 = common.sdc_128_package;

var MACHINE_UUID;
var MACHINE_UUID_2;
var HEADNODE_UUID;
var IMAGE;

var CLIENTS;
var CLIENT;
var SERVER;


// --- Helpers


function createLimit(t, cb) {
    return CLIENT.ufds.getUser(CLIENT.login, function (err, user) {
        t.ifError(err, 'CLIENT.getUser error');

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
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        SERVER  = server;

        createLimit(t, function () {
            t.end();
        });
    });
});


test('Get Headnode', function (t) {
    common.getHeadnode(CLIENT, function (err, headnode) {
        t.ifError(err);
        HEADNODE_UUID = headnode.uuid;
        t.end();
    });
});


test('Get base dataset', function (t) {
    common.getBaseDataset(CLIENT, function (err, img) {
        t.ifError(err);
        IMAGE = img;
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
        image: IMAGE.id,
        package: SDC_128.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE_UUID,
        firewall_enabled: true
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


test('CreateMachine #2', function (t) {
    var obj = {
        image: IMAGE.id,
        package: SDC_128.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE_UUID,
        firewall_enabled: true
    };

    machinesCommon.createMachine(t, CLIENT, obj, function (_, machineUuid) {
        MACHINE_UUID_2 = machineUuid;
        t.end();
    });
});


test('Wait For Running #2', function (t) {
    machinesCommon.waitForRunningMachine(CLIENT, MACHINE_UUID_2,
                                        function (err) {
        t.ifError(err);

        if (err) {
            // Skip machine tests when machine creation fails
            MACHINE_UUID_2 = false;
        }

        t.end();
    });
});


// This should fail due to limits:
test('CreateMachine #3', function (t) {
    var obj = {
        image: IMAGE.id,
        package: SDC_128.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE_UUID,
        firewall_enabled: true
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, body) {
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
    deleteTest(t, CLIENT, MACHINE_UUID, function () {
        t.end();
    });
});


test('Delete tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, CLIENT, MACHINE_UUID_2, function () {
        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function () {
        t.end();
    });
});
