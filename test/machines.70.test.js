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

var SERVER_UUID;
var IMAGE_UUID;
var MACHINE_UUID;

var LINUX_IMAGE_UUID;
var KVM_MACHINE_UUID;

var CLIENTS;
var CLIENT;
var OTHER;
var SERVER;


// --- Tests


test('setup', function (t) {
    common.setup({clientApiVersion: '~7.0'}, function (_, clients, server) {
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


// PUBAPI-567: Verify it has been fixed as side effect of PUBAPI-566
test('Create machine with invalid package', function (t) {
    var obj = {
        dataset: IMAGE_UUID,
        package: uuid().substr(0, 7),
        name: 'a' + uuid().substr(0, 7),
        server_uuid: SERVER_UUID
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err, 'POST /my/machines with invalid package error');
        console.log('Status Code: ' + res.statusCode);
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('CreateMachine w/o dataset fails', function (t) {
    var obj = {
        package: SDC_128.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: SERVER_UUID
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err, 'create machine w/o dataset error');
        t.equal(res.statusCode, 409, 'create machine w/o dataset status');
        t.ok(/image/.test(err.message));
        t.end();
    });
});


test('Create machine with invalid network', function (t) {
    var obj = {
        dataset: IMAGE_UUID,
        package: SDC_128.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: SERVER_UUID,
        networks: [uuid()]
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err, 'POST /my/machines with invalid network error');
        console.log('Status Code: ' + res.statusCode);
        t.equal(res.statusCode, 409);
        t.end();
    });
});


// Test using IMAGE.uuid instead of IMAGE.name due to PUBAPI-625:
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


test('Get Machine,  with Firewall Enabled', function (t) {
    if (!MACHINE_UUID) {
        return t.end();
    }

    var path = '/my/machines/' + MACHINE_UUID;

    return CLIENT.get(path, function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines/:id error');
        t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
        t.ok(body, 'GET /my/machines/:id body');
        t.ok(body.firewall_enabled, 'machine firewall enabled');
        // Make sure we are not including credentials:
        t.equal(typeof (body.metadata.credentials), 'undefined',
                'Machine Credentials');
        // Same for networks:
        t.equal(typeof (body.networks), 'undefined', 'Machine networks');

        common.checkHeaders(t, res.headers);
        common.checkReqId(t, res.headers);
        checkMachine(t, body);

        // Double check tags are OK, due to different handling by VMAPI:
        var tags = {};
        tags[machinesCommon.TAG_KEY] = machinesCommon.TAG_VAL;
        t.deepEqual(body.tags, tags, 'Machine tags');

        t.end();
    });
});


test('Rename machine tests', function (t) {
    var renameTest = require('./machines/rename');
    renameTest(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('Firewall tests', function (t) {
    var firewallTest = require('./machines/firewall');
    firewallTest(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('Delete tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('KVM image', function (t) {
    CLIENT.get('/my/images?os=linux', function (er1, req1, res1, body1) {
        t.ifError(er1, 'GET /my/images error');
        t.equal(res1.statusCode, 200, 'GET /my/images status');
        common.checkHeaders(t, res1.headers);
        t.ok(body1, 'GET /my/images body');
        t.ok(Array.isArray(body1), 'GET /my/images body is an array');
        // Do nothing if we haven't got a Linux image already imported
        if (body1.length === 0) {
            console.log('No KVM images imported, skipping KVM provisioning');
        } else {
            LINUX_IMAGE_UUID = body1[0].id;
        }
        t.end();
    });
});


test('Create KVM machine', function (t) {
    if (LINUX_IMAGE_UUID) {
        var obj = {
            image: LINUX_IMAGE_UUID,
            package: SDC_128.name,
            name: 'a' + uuid().substr(0, 7),
            server_uuid: SERVER_UUID
        };

        CLIENT.post('/my/machines', obj, function (err, req, res, body) {
            t.ifError(err, 'POST /my/machines error');
            t.equal(res.statusCode, 201, 'POST /my/machines status');
            common.checkHeaders(t, res.headers);
            t.equal(res.headers.location,
                util.format('/%s/machines/%s', CLIENT.login, body.id));
            t.ok(body, 'POST /my/machines body');
            checkMachine(t, body);

            KVM_MACHINE_UUID = body.id;

            // Handy to output this to stdout in order to poke around COAL:
            console.log('Requested provision of KVM machine: %s',
                        KVM_MACHINE_UUID);
            t.end();
        });
    } else {
        t.end();
    }
});


test('Wait For KVM machine Running', function (t) {
    if (!KVM_MACHINE_UUID) {
        return t.end();
    }

    return machinesCommon.waitForRunningMachine(CLIENT, KVM_MACHINE_UUID,
                                        function (err) {
        t.ifError(err);

        if (err) {
            // Skip machine tests when machine creation fails
            KVM_MACHINE_UUID = false;
        }

        t.end();
    });
});


test('Delete KVM tests', function (t) {
    if (KVM_MACHINE_UUID) {
        var deleteTest = require('./machines/delete');
        deleteTest(t, CLIENT, OTHER, KVM_MACHINE_UUID, function () {
            t.end();
        });
    } else {
        t.end();
    }
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
