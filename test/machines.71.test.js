/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var util = require('util');
var test = require('tape').test;
var common = require('./common');
var uuid = common.uuid;
var machinesCommon = require('./machines/common');
var checkMachine = machinesCommon.checkMachine;
var checkNotFound = common.checkNotFound;


// --- Globals


var SDC_128 = common.sdc_128_package;

var SERVER_UUID;
var MACHINE_UUID;
var IMAGE_UUID;
var IMAGE_JOB_UUID;

var CLIENTS;
var CLIENT;
var OTHER;
var SERVER;


// --- Tests


test('setup', function (t) {
    common.setup({clientApiVersion: '~7.1'}, function (_, clients, server) {
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
        'package': uuid().substr(0, 7),
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


test('Get Machine', function (t) {
    machinesCommon.getMachine(t, CLIENT, MACHINE_UUID, function (_, machine) {
        // Double check tags are OK, due to different handling by VMAPI:
        var tags = {};
        tags[machinesCommon.TAG_KEY] = machinesCommon.TAG_VAL;
        t.deepEqual(machine.tags, tags, 'Machine tags');

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


test('Stop test', function (t) {
    var stopTest = require('./machines/stop');
    stopTest(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('Create image from machine (missing params)', function (t) {
    if (MACHINE_UUID) {
        // Missing name attribute:
        var obj = {
            machine: MACHINE_UUID,
            version: '1.0.0'
        };

        CLIENT.post({
            path: '/my/images',
            headers: {
                'accept-version': '~7.1'
            }
        }, obj, function (err, req, res, body) {
            t.ok(err, 'missing parameters error');
            t.equal(res.statusCode, 409);
            t.ok(err.message);
            t.end();
        });
    } else {
        t.end();
    }
});


test('Create image from machine - other', function (t) {
    if (MACHINE_UUID) {
        var obj = {
            machine: MACHINE_UUID,
            name: uuid(),
            version: '1.0.0'
        };

        OTHER.post({
            path: '/my/images',
            headers: {
                'accept-version': '~7.1'
            }
        }, obj, function (err, req, res, body) {
            t.ok(err);
            t.ok(body);

            if (err.name !== 'NotAvailableError') {
                t.equal(err.restCode, 'InvalidParameter');
                t.ok(err.message);

                t.equal(body.code, 'InvalidParameter');
                t.ok(body.message);

                t.equal(res.statusCode, 422);
            }

            return t.end();
        });
    } else {
        t.end();
    }
});


test('Create image from machine OK', function (t) {
    if (MACHINE_UUID) {
        var obj = {
            machine: MACHINE_UUID,
            name: uuid(),
            version: '1.0.0'
        };

        CLIENT.post({
            path: '/my/images',
            headers: {
                'accept-version': '~7.1'
            }
        }, obj, function (err, req, res, body) {
            if (err && err.name === 'NotAvailableError') {
                return t.end();
            } else {
                t.ifError(err);
            }

            t.ok(body);

            IMAGE_UUID = body.id;

            t.ok(res.headers['x-joyent-jobid'], 'jobid header');

            IMAGE_JOB_UUID = res.headers['x-joyent-jobid'];

            return t.end();
        });
    } else {
        t.end();
    }
});


test('Wait for img create job', function (t) {
    if (IMAGE_JOB_UUID) {
        machinesCommon.waitForWfJob(CLIENT, IMAGE_JOB_UUID, function (err) {
            if (err) {
                IMAGE_UUID = null;
            }

            t.ifError(err, 'create image job ' + IMAGE_JOB_UUID);
            t.end();
        });
    } else {
        t.end();
    }
});


test('Update image', function (t) {
    var obj = { name: uuid(), version: '1.1.0' };
    if (IMAGE_JOB_UUID) {
        var opts = {
            path: '/my/images/' + IMAGE_UUID,
            query: { action: 'update' }
        };

        CLIENT.post(opts, obj, function (err, req, res, body) {
            t.ifError(err, 'Update Image error');
            t.end();
        });
    } else {
        t.end();
    }
});


test('Update image - other', function (t) {
    var obj = { name: uuid(), version: '1.1.0' };
    if (IMAGE_JOB_UUID) {
        var opts = {
            path: '/my/images/' + IMAGE_UUID,
            query: { action: 'update' }
        };

        OTHER.post(opts, obj, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    } else {
        t.end();
    }
});


test('Delete image', function (t) {
    if (IMAGE_JOB_UUID) {
        CLIENT.imgapi.deleteImage(IMAGE_UUID, function (err, res) {
            t.ifError(err, 'Delete Image error');
            t.end();
        });
    } else {
        t.end();
    }
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
