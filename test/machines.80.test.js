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


// --- Tests


test('setup', function (t) {
    common.setup({clientApiVersion: '~8.0'}, function (_, clients, server) {
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


test('CreateMachine', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_128.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: SERVER_UUID,
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


test('GetMachine', function (t) {
    machinesCommon.getMachine(t, CLIENT, MACHINE_UUID, function (_, machine) {
        t.equal(machine.brand, 'joyent');
        t.end();
    });
});


test('ListMachines (filter by joyent brand)', function (t) {
    CLIENT.get('/my/machines?brand=joyent', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.ok(Array.isArray(body));

        // at the moment, only the machine created in the above tests should
        // list here:
        t.equal(body.length, 1);
        t.equal(body[0].id, MACHINE_UUID);
        t.equal(body[0].brand, 'joyent');

        checkMachine(t, body[0]);

        t.end();
    });
});


test('ListMachines (filter by joyent brand) - other', function (t) {
    OTHER.get('/my/machines?brand=joyent', function (err, req, res, body) {
        t.ifError(err);
        t.deepEqual(body, []);
        t.end();
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
