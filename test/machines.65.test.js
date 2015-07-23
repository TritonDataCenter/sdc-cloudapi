/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var util = require('util');
var test = require('tape').test;
var common = require('./common');
var uuid = common.uuid;
var machinesCommon = require('./machines/common');
var checkMachine = machinesCommon.checkMachine;


// --- Globals


var SDC_128 = common.sdc_128_package;

var HEADNODE_UUID;
var MACHINE_UUID;

var CLIENTS;
var CLIENT;
var SERVER;


// --- Tests


test('setup', function (t) {
    common.setup('~6.5', function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        SERVER  = server;

        t.end();
    });
});


test('Get Headnode', function (t) {
    common.getHeadnode(CLIENT, function (err, headnode) {
        t.ifError(err);
        HEADNODE_UUID = headnode.uuid;
        t.end();
    });
});


test('CreateMachine', function (t) {
    var obj = {
        dataset: 'smartos',
        package: SDC_128.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE_UUID
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

test('Get Machine', function (t) {
    if (!MACHINE_UUID) {
        return t.end();
    }

    var path = '/my/machines/' + MACHINE_UUID;

    return CLIENT.get(path, function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines/:id error');
        t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
        t.ok(body, 'GET /my/machines/:id body');
        t.equal(typeof (body.networks), 'undefined', 'machine networks');
        t.equal(typeof (body.compute_node), 'undefined',
                'machine compute_node');
        t.equal(typeof (body.firewall_enabled), 'undefined',
                'machine firewall enabled');

        common.checkHeaders(t, res.headers);
        checkMachine(t, body);

        // Double check tags are OK, due to different handling by VMAPI:
        var tags = {};
        tags[machinesCommon.TAG_KEY] = machinesCommon.TAG_VAL;
        t.deepEqual(body.tags, tags, 'Machine tags');
        t.end();
    });
});


test('Rename Machine 6.5.0', function (t) {
    CLIENT.post('/my/machines/' + MACHINE_UUID, {
        action: 'rename',
        name: 'b' + uuid().substr(0, 7)
    }, function (err) {
        t.ok(err, 'Rename machine error');
        t.end();
    });
});


test('Delete tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, CLIENT, MACHINE_UUID, function () {
        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function () {
        t.end();
    });
});
