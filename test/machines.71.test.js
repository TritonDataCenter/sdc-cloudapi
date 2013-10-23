// Copyright 2013 Joyent, Inc. All rights reserved.

var fs = require('fs');
var util = require('util');
var test = require('tap').test;
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

var TAP_CONF = {
    timeout: 'Infinity '
};


// May or not be created by previous test run or whatever else:
var sdc_256_inactive = {
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
    urn: 'sdc:' + uuid() + ':sdc_256_inactive:1.0.0',
    active: false
};

var sdc_128_ok = {
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
    urn: 'sdc:' + uuid() + ':sdc_128_ok:1.0.0',
    active: true
};


var sdc_256_entry, sdc_256_inactive_entry, sdc_128_ok_entry;

var HEADNODE = null;

var CREATE_IMAGES = false;

// --- Tests

test('setup', TAP_CONF, function (t) {
    common.setup('~7.1', function (err, _client, _server) {
        t.ifError(err, 'common setup error');
        t.ok(_client, 'common _client ok');
        client = _client;
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
        }
        server = _server;
        var cfg = common.getCfg();
        if (cfg.bleeding_edge_features &&
            cfg.bleeding_edge_features.img_mgmt &&
            cfg.bleeding_edge_login_whitelist &&
            cfg.bleeding_edge_login_whitelist['*']) {
            CREATE_IMAGES = true;
        }
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


test('Get Headnode', TAP_CONF, function (t) {
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

test('get smartos dataset', TAP_CONF, function (t) {
    client.get('/my/datasets?name=smartos', function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets error');
        t.equal(res.statusCode, 200, 'GET /my/datasets status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets body');
        t.ok(Array.isArray(body), 'GET /my/datasets body is an array');
        t.ok(body.length, 'GET /my/datasets body array has elements');
        body.forEach(function (d) {
            if (d.version && d.version === '1.6.3') {
                DATASET = body[0].id;
            }
        });
        t.end();
    });
});


// PUBAPI-567: Verify it has been fixed as side effect of PUBAPI-566
test('Create machine with invalid package', TAP_CONF, function (t) {
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


test('CreateMachine w/o dataset fails', TAP_CONF, function (t) {
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


test('Create machine with invalid network', TAP_CONF, function (t) {
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
test('CreateMachine', TAP_CONF, function (t) {
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


test('Wait For Running', TAP_CONF,  function (t) {
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


test('Get Machine', TAP_CONF, function (t) {
    if (machine) {
        client.get('/my/machines/' + machine, function (err, req, res, body) {
            t.ifError(err, 'GET /my/machines/:id error');
            t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'GET /my/machines/:id body');
            checkMachine(t, body);
            t.ok(body.compute_node, 'machine compute_node');
            t.ok(body.firewall_enabled, 'machine firewall enabled');
            t.ok(body.networks, 'machine networks');
            t.ok(Array.isArray(body.networks), 'machine networks array');
            // Double check tags are OK, due to different handling by VMAPI:
            var tags = {};
            tags[TAG_KEY] = TAG_VAL;
            t.equivalent(body.tags, tags, 'Machine tags');
            t.end();
        });
    }
});


var IMG_JOB_UUID;

test('Attempt to create image from running machine', TAP_CONF, function (t) {
    if (CREATE_IMAGES && machine) {
        var obj = {
            machine: machine,
            name: uuid(),
            version: '1.0.0'
        };
        client.post({
            path: '/my/images',
            headers: {
                'accept-version': '~7.1'
            }
        }, obj, function (err, req, res, body) {
            t.ifError(err);
            t.ok(body);
            t.ok(res.headers['x-joyent-jobid'], 'jobid header');
            IMG_JOB_UUID = res.headers['x-joyent-jobid'];
            t.end();
        });
    } else {
        t.end();
    }
});


test('Wait for img create from running machine job', TAP_CONF, function (t) {
    if (CREATE_IMAGES && machine) {
        waitForWfJob(client, IMG_JOB_UUID, function (err) {
            t.ok(err, 'Image job error');
            t.equal(err.message, 'Job failed');
            t.end();
        });
    } else {
        t.end();
    }
});


test('Rename machine tests', TAP_CONF, function (t) {
    var renameTest = require('./machines/rename');
    renameTest(t, client, machine, function () {
        t.end();
    });
});


test('Firewall tests', TAP_CONF, function (t) {
    var firewallTest = require('./machines/firewall');
    firewallTest(t, client, machine, function () {
        t.end();
    });
});


test('Stop test', TAP_CONF, function (t) {
    var stopTest = require('./machines/stop');
    stopTest(t, client, machine, function () {
        t.end();
    });
});


test('Create image from machine (missing params)', TAP_CONF, function (t) {
    if (CREATE_IMAGES && machine) {
        // Missing name attribute:
        var obj = {
            machine: machine,
            version: '1.0.0'
        };
        client.post({
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


test('Create image from machine OK', TAP_CONF, function (t) {
    if (CREATE_IMAGES && machine) {
        var obj = {
            machine: machine,
            name: uuid(),
            version: '1.0.0'
        };
        client.post({
            path: '/my/images',
            headers: {
                'accept-version': '~7.1'
            }
        }, obj, function (err, req, res, body) {
            t.ifError(err);
            t.ok(body);
            image_uuid = body.id;
            t.ok(res.headers['x-joyent-jobid'], 'jobid header');
            IMG_JOB_UUID = res.headers['x-joyent-jobid'];
            t.end();
        });
    } else {
        t.end();
    }
});


test('Wait for img create job', TAP_CONF, function (t) {
    if (CREATE_IMAGES && machine) {
        waitForWfJob(client, IMG_JOB_UUID, function (err) {
            if (err) {
                image_uuid = null;
            }
            t.ifError(err, 'create image job');
            t.end();
        });
    } else {
        t.end();
    }
});


test('Delete image', TAP_CONF, function (t) {
    if (CREATE_IMAGES && image_uuid) {
        client.imgapi.deleteImage(image_uuid, function (err, res) {
            t.ifError(err, 'Delete Image error');
            t.end();
        });
    } else {
        t.end();
    }
});



test('Delete tests', TAP_CONF, function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, client, machine, function () {
        t.end();
    });
});




test('teardown', {timeout: 'Infinity '}, function (t) {
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
