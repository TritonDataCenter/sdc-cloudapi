/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var fs = require('fs');
var util = require('util');
var test = require('tape').test;
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var sprintf = util.format;
var common = require('./common');
var machinesCommon = require('./machines/common');
var checkMachine = machinesCommon.checkMachine;
var checkJob = machinesCommon.checkJob;
var waitForJob = machinesCommon.waitForJob;
var checkWfJob = machinesCommon.checkWfJob;
var waitForWfJob = machinesCommon.waitForWfJob;
var saveKey = machinesCommon.saveKey;
var addPackage = machinesCommon.addPackage;
// --- Globals

var client, server, snapshot;
var keyName = uuid();
var machine;
var image_uuid;
var KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEAvad19ePSDckmgmo6Unqmd8' +
    'n2G7o1794VN3FazVhV09yooXIuUhA+7OmT7ChiHueayxSubgL2MrO/HvvF/GGVUs/t3e0u4' +
    '5YwRC51EVhyDuqthVJWjKrYxgDMbHru8fc1oV51l0bKdmvmJWbA/VyeJvstoX+eiSGT3Jge' +
    'egSMVtc= mark@foo.local';

var TAG_KEY = 'role';
var TAG_VAL = 'unitTest';

var META_KEY = 'foo';
var META_VAL = 'bar';

var META_64_KEY = 'sixtyfour';
var META_64_VAL = new Buffer('Hello World').toString('base64');

var META_CREDS = {
    'root': 'secret',
    'admin': 'secret'
};

var META_CREDS_TWO = {
    'root': 'secret',
    'admin': 'secret',
    'jill': 'secret'
};


// May or not be created by previous test run or whatever else:
var sdc_256_inactive = {
    uuid: '4633473b-aae9-466b-8bde-3c410e5072cc',
    name: 'sdc_256_inactive',
    version: '1.0.0',
    max_physical_memory: 256,
    quota: 10240,
    max_swap: 512,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    'default': false,
    vcpus: 1,
    active: false
};

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


var sdc_256_entry, sdc_256_inactive_entry, sdc_128_ok_entry;

var HEADNODE = null;


// --- Tests

test('setup', function (t) {
    common.setup('~7.0', function (err, _client, _server) {
        t.ifError(err, 'common setup error');
        t.ok(_client, 'common _client ok');

        client = _client;
        server = _server;

        saveKey(KEY, keyName, client, t, function () {
            // Add custom packages; "sdc_" ones will be owned by admin user:
            addPackage(client, sdc_128_ok, function (err2, entry) {
                t.ifError(err2, 'Add package error');
                sdc_128_ok_entry = entry;

                addPackage(client, sdc_256_inactive, function (err3, entry2) {
                    t.ifError(err3, 'Add package error');
                    sdc_256_inactive_entry = entry2;

                    t.end();
                });
            });
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


var DATASET;

test('get smartos dataset', function (t) {
    client.get('/my/datasets?name=smartos', function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets error');
        t.equal(res.statusCode, 200, 'GET /my/datasets status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets body');
        t.ok(Array.isArray(body), 'GET /my/datasets body is an array');
        t.ok(body.length, 'GET /my/datasets body array has elements');
        body.forEach(function (d) {
            if (d.version && d.version === '1.6.3') {
                DATASET = d.id;
            }
        });
        t.end();
    });
});


// PUBAPI-567: Verify it has been fixed as side effect of PUBAPI-566
test('Create machine with invalid package', function (t) {
    var obj = {
        dataset: DATASET,
        'package': uuid().substr(0, 7),
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid
    };

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err, 'POST /my/machines with invalid package error');
        console.log('Status Code: ' + res.statusCode);
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('CreateMachine w/o dataset fails', function (t) {
    var obj = {
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid
    };
    obj['metadata.' + META_KEY] = META_VAL;
    obj['tag.' + TAG_KEY] = TAG_VAL;

    obj['metadata.credentials'] = META_CREDS;

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err, 'create machine w/o dataset error');
        t.equal(res.statusCode, 409, 'create machine w/o dataset status');
        t.ok(/image/.test(err.message));
        t.end();
    });
});


test('Create machine with invalid network', function (t) {
    var obj = {
        dataset: DATASET,
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid,
        networks: [uuid()]
    };

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err, 'POST /my/machines with invalid network error');
        console.log('Status Code: ' + res.statusCode);
        t.equal(res.statusCode, 409);
        t.end();
    });
});


// Test using IMAGE.uuid instead of IMAGE.name due to PUBAPI-625:
test('CreateMachine', function (t) {
    var obj = {
        image: DATASET,
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid,
        firewall_enabled: true
    };
    obj['metadata.' + META_KEY] = META_VAL;
    obj['tag.' + TAG_KEY] = TAG_VAL;

    obj['metadata.credentials'] = META_CREDS;

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ifError(err, 'POST /my/machines error');
        t.equal(res.statusCode, 201, 'POST /my/machines status');
        common.checkHeaders(t, res.headers);
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


test('Get Machine Firewall Enabled', function (t) {
    if (machine) {
        client.get('/my/machines/' + machine, function (err, req, res, body) {
            t.ifError(err, 'GET /my/machines/:id error');
            t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'GET /my/machines/:id body');
            checkMachine(t, body);
            t.ok(body.firewall_enabled, 'machine firewall enabled');
            // Make sure we are not including credentials:
            t.equal(typeof (body.metadata.credentials), 'undefined',
                'Machine Credentials');
            // Same for networks:
            t.equal(typeof (body.networks), 'undefined', 'Machine networks');
            // Double check tags are OK, due to different handling by VMAPI:
            var tags = {};
            tags[TAG_KEY] = TAG_VAL;
            t.deepEqual(body.tags, tags, 'Machine tags');
            t.end();
        });
    }
});


test('Rename machine tests', function (t) {
    var renameTest = require('./machines/rename');
    renameTest(t, client, machine, function () {
        t.end();
    });
});


test('Firewall tests', function (t) {
    var firewallTest = require('./machines/firewall');
    firewallTest(t, client, machine, function () {
        t.end();
    });
});


test('Delete tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, client, machine, function () {
        t.end();
    });
});


var LINUX_DS = false;
var KVM_MACHINE = false;

test('KVM dataset', function (t) {
    client.get('/my/images?os=linux', function (er1, req1, res1, body1) {
        t.ifError(er1, 'GET /my/images error');
        t.equal(res1.statusCode, 200, 'GET /my/images status');
        common.checkHeaders(t, res1.headers);
        t.ok(body1, 'GET /my/images body');
        t.ok(Array.isArray(body1), 'GET /my/images body is an array');
        // Do nothing if we haven't got a Linux image already imported
        if (body1.length === 0) {
            console.log('No KVM images imported, skipping KVM provisioning');
        } else {
            LINUX_DS = body1[0].id;
        }
        t.end();
    });
});


test('Create KVM machine', function (t) {
    if (LINUX_DS) {
        var obj = {
            image: LINUX_DS,
            'package': 'sdc_128_ok',
            name: 'a' + uuid().substr(0, 7),
            server_uuid: HEADNODE.uuid
        };
        client.post('/my/machines', obj, function (err, req, res, body) {
            t.ifError(err, 'POST /my/machines error');
            t.equal(res.statusCode, 201, 'POST /my/machines status');
            common.checkHeaders(t, res.headers);
            t.equal(res.headers.location,
                util.format('/%s/machines/%s', client.testUser, body.id));
            t.ok(body, 'POST /my/machines body');
            checkMachine(t, body);
            KVM_MACHINE = body.id;
            // Handy to output this to stdout in order to poke around COAL:
            console.log('Requested provision of KVM machine: %s', KVM_MACHINE);
            t.end();
        });
    } else {
        t.end();
    }
});



test('Wait For KVM machine Running', function (t) {
    if (KVM_MACHINE) {
        client.vmapi.listJobs({
            vm_uuid: KVM_MACHINE,
            task: 'provision'
        }, function (err, jobs) {
            if (err) {
                KVM_MACHINE = false;
            }
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs ok');
            t.ok(jobs.length, 'list jobs is an array');
            waitForJob(client, jobs[0].uuid, function (err2) {
                if (err2) {
                    KVM_MACHINE = false;
                }
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    } else {
        t.end();
    }
});

test('Delete KVM tests', function (t) {
    if (KVM_MACHINE) {
        var deleteTest = require('./machines/delete');
        deleteTest(t, client, KVM_MACHINE, function () {
            t.end();
        });
    } else {
        t.end();
    }
});


test('teardown', function (t) {
    client.del('/my/keys/' + keyName, function (err, req, res) {
        t.ifError(err, 'delete key error');
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        client.teardown(function (err2) {
            // Ignore err2 here, just means we have not been able to remove
            // something from ufds.
            if (server) {
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
