// Copyright 2013 Joyent, Inc. All rights reserved.

var fs = require('fs');
var util = require('util');
var test = require('tap').test;
var uuid = require('node-uuid');
var sprintf = util.format;
var common = require('./common');
var machinesCommon = require('./machines/common');
var checkMachine = machinesCommon.checkMachine;
var checkJob = machinesCommon.checkJob;
var waitForJob = machinesCommon.waitForJob;
var checkWfJob = machinesCommon.checkWfJob;
var waitForWfJob = machinesCommon.waitForWfJob;
var saveKey = machinesCommon.saveKey;
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

// --- Helpers


// Add custom packages, given "sdc_" default ones will be owner by admin user.
function add128Ok(t, cb) {
    return client.pkg.get(sdc_128_ok.urn, function (err, pkg) {
        if (err) {
            if (err.restCode === 'ResourceNotFound') {
                return client.pkg.add(sdc_128_ok, function (err2, pkg2) {
                    t.ifError(err2, 'Error creating package');
                    t.ok(pkg2, 'Package created OK');
                    sdc_128_ok_entry = pkg2;
                    return cb();
                });
            } else {
                t.ifError(err, 'Error fetching package');
                return cb();
            }
        } else {
            sdc_128_ok_entry = pkg;
            return cb();
        }
    });
}

function add256Inactive(t, cb) {
    return client.pkg.get(sdc_256_inactive.urn, function (err4, pkg) {
        if (err4) {
            if (err4.restCode === 'ResourceNotFound') {
                return client.pkg.add(sdc_256_inactive, function (err5, pkg2) {
                    t.ifError(err5, 'Error creating package');
                    t.ok(pkg2, 'Package created OK');
                    sdc_256_inactive_entry = pkg2;
                    return cb();
                });
            } else {
                t.ifError(err4, 'Error fetching package');
                return cb();
            }
        } else {
            sdc_256_inactive_entry = pkg;
            return cb();
        }
    });
}

// --- Tests

test('setup', TAP_CONF, function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err, 'common setup error');
        t.ok(_client, 'common _client ok');
        client = _client;
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
        }
        server = _server;

        saveKey(KEY, keyName, client, t, function () {
            add128Ok(t, function () {
                add256Inactive(t, function () {
                    t.end();
                });
            });
        });
    });
});


test('ListMachines (empty)', TAP_CONF, function (t) {
    client.get('/my/machines', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines Status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'body is an array');
        t.ok(!body.length, 'body array is empty');
        t.end();
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


test('CreateMachine (6.5)', TAP_CONF, function (t) {
    var obj = {
        dataset: 'smartos',
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid
    };
    obj['metadata.' + META_KEY] = META_VAL;
    obj['metadata.' + META_64_KEY] = META_64_VAL;
    obj['tag.' + TAG_KEY] = TAG_VAL;

    obj['metadata.credentials'] = META_CREDS;

    client.post({
        path: '/my/machines',
        headers: {
            'accept-version': '~6.5'
        }
    }, obj, function (err, req, res, body) {
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
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs ok');
        t.ok(jobs.length, 'list jobs is an array');
        waitForJob(client, jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('Create machine with inactive package', TAP_CONF, function (t) {
    var obj = {
        dataset: 'smartos',
        'package': sdc_256_inactive_entry.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid
    };

    client.post({
        path: '/my/machines',
        headers: {
            'accept-version': '~6.5'
        }
    }, obj, function (err, req, res, body) {
        t.ok(err, 'POST /my/machines with inactive package error');
        var cfg = common.getCfg();
        var capi_limits = cfg.plugins.filter(function (p) {
            return (p.name === 'capi_limits');
        })[0];
        if (capi_limits.enabled) {
            t.equal(res.statusCode, 403);
        } else {
            t.equal(res.statusCode, 409);
        }
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

test('Create machine with invalid network', TAP_CONF, function (t) {
    var obj = {
        dataset: DATASET,
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid,
        networks: [uuid()]
    };

    client.post({
        path: '/my/machines',
        headers: {
            'accept-version': '~7.0'
        }
    }, obj, function (err, req, res, body) {
        t.ok(err, 'POST /my/machines with invalid network error');
        console.log('Status Code: ' + res.statusCode);
        t.equal(res.statusCode, 409);
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

    client.post({
        path: '/my/machines',
        headers: {
            'accept-version': '~7.0'
        }
    }, obj, function (err, req, res, body) {
        t.ok(err, 'POST /my/machines with invalid package error');
        console.log('Status Code: ' + res.statusCode);
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('CreateMachine (7.0) w/o dataset fails', TAP_CONF, function (t) {
    var obj = {
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid
    };
    obj['metadata.' + META_KEY] = META_VAL;
    obj['tag.' + TAG_KEY] = TAG_VAL;

    obj['metadata.credentials'] = META_CREDS;

    client.post({
        path: '/my/machines',
        headers: {
            'accept-version': '~7.0'
        }
    }, obj, function (err, req, res, body) {
        t.ok(err, 'create machine w/o dataset error');
        t.equal(res.statusCode, 409, 'create machine w/o dataset status');
        t.ok(/image/.test(err.message));
        t.end();
    });
});


test('ListMachines all', TAP_CONF, function (t) {
    client.get('/my/machines', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'GET /my/machines body is array');
        t.ok(body.length, 'GET /my/machines list is not empty');
        body.forEach(function (m) {
            checkMachine(t, m);
        });
        t.end();
    });
});


test('Get Machine', TAP_CONF, function (t) {
    client.get({
        path: '/my/machines/' + machine,
        headers: {
            'accept-version': '~7.0'
        }
    }, function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines/:id error');
        t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines/:id body');
        checkMachine(t, body);
        // Double check tags are OK, due to different handling by VMAPI:
        var tags = {};
        tags[TAG_KEY] = TAG_VAL;
        t.equivalent(body.tags, tags, 'Machine tags');
        // Make sure we are not including credentials:
        t.equal(typeof (body.metadata.credentials), 'undefined',
            'Machine Credentials');
        // Same for networks:
        // console.log(util.inspect(body, false, 8, true));
        // t.equal(typeof (body.networks), 'undefined', 'Machine networks');
        t.end();
    });
});


test('Get Machine (7.1)', TAP_CONF, function (t) {
    client.get({
        path: '/my/machines/' + machine,
        headers: {
            'accept-version': '~7.1'
        }
    }, function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines/:id error');
        t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines/:id body');
        checkMachine(t, body);
        // console.log(util.inspect(body, false, 8, true));
        // t.ok(body.networks, 'machine networks');
        // t.ok(Array.isArray(body.networks), 'machine networks array');
        t.end();
    });
});

test('Get Machine Include Credentials', TAP_CONF, function (t) {
    var url = '/my/machines/' + machine + '?credentials=true';
    client.get(url, function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines/:id error');
        t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines/:id body');
        checkMachine(t, body);
        t.equal(typeof (body.metadata.credentials), 'object');
        Object.keys(META_CREDS).forEach(function (k) {
            t.equal(body.metadata.credentials[k], META_CREDS[k]);
        });
        t.end();
    });
});

var IMG_JOB_UUID;

test('Attempt to create image from running machine', TAP_CONF, function (t) {
    if (common.getCfg().create_images === true) {
        var obj = {
            machine: machine,
            name: uuid(),
            version: '1.0.0'
        };
        client.post({
            path: '/my/images',
            headers: {
                'accept-version': '~7.0'
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
    if (common.getCfg().create_images === true) {
        waitForWfJob(client, IMG_JOB_UUID, function (err) {
            t.ok(err, 'Image job error');
            t.equal(err.message, 'Job failed');
            t.end();
        });
    } else {
        t.end();
    }
});


test('Stop test', TAP_CONF, function (t) {
    var stopTest = require('./machines/stop');
    stopTest(t, client, machine, function () {
        t.end();
    });
});


test('Create image from machine (missing params)', TAP_CONF, function (t) {
    if (common.getCfg().create_images === true) {
        // Missing name attribute:
        var obj = {
            machine: machine,
            version: '1.0.0'
        };
        client.post({
            path: '/my/images',
            headers: {
                'accept-version': '~7.0'
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
    if (common.getCfg().create_images === true) {
        var obj = {
            machine: machine,
            name: uuid(),
            version: '1.0.0'
        };
        client.post({
            path: '/my/images',
            headers: {
                'accept-version': '~7.0'
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
    if (common.getCfg().create_images === true) {
        waitForWfJob(client, IMG_JOB_UUID, function (err) {
            t.ifError(err, 'create image job');
            t.end();
        });
    } else {
        t.end();
    }
});


test('Delete image', TAP_CONF, function (t) {
    if (common.getCfg().create_images === true && image_uuid) {
        client.imgapi.deleteImage(image_uuid, function (err, res) {
            t.ifError(err, 'Delete Image error');
            t.end();
        });
    } else {
        t.end();
    }
});


test('Start test', TAP_CONF, function (t) {
    var startTest = require('./machines/start');
    startTest(t, client, machine, function () {
        t.end();
    });
});


test('Reboot test', TAP_CONF, function (t) {
    var rebootTest = require('./machines/reboot');
    rebootTest(t, client, machine, function () {
        t.end();
    });
});



test('Resize machine to inactive package', TAP_CONF, function (t) {
    client.post('/my/machines/' + machine, {
        action: 'resize',
        'package': sdc_256_inactive_entry.name
    }, function (err, req, res, body) {
        t.ok(err, 'Resize to inactive package error');
        t.equal(res.statusCode, 409, 'Resize to inactive pkg status');
        t.end();
    });
});


test('Resize Machine', TAP_CONF, function (t) {
    t.ok(sdc_128_ok_entry, 'Resize package OK');
    console.log('Resizing to package: %j', sdc_128_ok_entry);
    client.post('/my/machines/' + machine, {
        action: 'resize',
        'package': sdc_128_ok_entry.name
    }, function (err) {
        t.ifError(err, 'Resize machine error');
        t.end();
    });
});


test('Wait For Resized', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'update'
    }, function (err, jobs) {
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs OK');
        t.ok(jobs.length, 'update jobs is array');
        var resize_jobs = jobs.filter(function (job) {
            return (typeof (job.params.max_physical_memory) !== 'undefined');
        });
        t.ok(resize_jobs.length, 'resize jobs is an array');
        waitForJob(client, resize_jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('Rename Machine 6.5.0', TAP_CONF, function (t) {
    client.post({
        path: '/my/machines/' + machine,
        headers: {
            'accept-version': '~6.5'
        }
    }, {
        action: 'rename',
        name: 'b' + uuid().substr(0, 7)
    }, function (err) {
        t.ok(err, 'Rename machine error');
        t.end();
    });
});


test('Rename Machine 7.0.0', TAP_CONF, function (t) {
    client.post({
        path: '/my/machines/' + machine,
        headers: {
            'accept-version': '~7.0'
        }
    }, {
        action: 'rename',
        name: 'b' + uuid().substr(0, 7)
    }, function (err) {
        t.ifError(err, 'Rename machine error');
        t.end();
    });
});


test('Wait For Renamed', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'update'
    }, function (err, jobs) {
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs OK');
        t.ok(jobs.length, 'update jobs is array');
        var rename_jobs = jobs.filter(function (job) {
            return (typeof (job.params.alias) !== 'undefined');
        });
        t.ok(rename_jobs.length, 'rename jobs is an array');
        waitForJob(client, rename_jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('Enable firewall 7.0.0', TAP_CONF, function (t) {
    client.post({
        path: '/my/machines/' + machine,
        headers: {
            'accept-version': '~7.0'
        }
    }, {
        action: 'enable_firewall'
    }, function (err) {
        t.ifError(err, 'Enable firewall error');
        t.end();
    });
});


test('Wait For Firewall Enabled', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'update'
    }, function (err, jobs) {
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs OK');
        t.ok(jobs.length, 'update jobs is array');
        var firewall_jobs = jobs.filter(function (job) {
            return (typeof (job.params.firewall_enabled) !== 'undefined');
        });
        t.ok(firewall_jobs.length, 'firewall jobs is an array');
        waitForJob(client, firewall_jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('Disable firewall 7.0.0', TAP_CONF, function (t) {
    client.post({
        path: '/my/machines/' + machine,
        headers: {
            'accept-version': '~7.0'
        }
    }, {
        action: 'disable_firewall'
    }, function (err) {
        t.ifError(err, 'Enable firewall error');
        t.end();
    });
});


test('Wait For Firewall Disabled', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'update'
    }, function (err, jobs) {
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs OK');
        t.ok(jobs.length, 'update jobs is array');
        var firewall_jobs = jobs.filter(function (job) {
            return (typeof (job.params.firewall_enabled) !== 'undefined');
        });
        t.ok(firewall_jobs.length, 'firewall jobs is an array');
        waitForJob(client, firewall_jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('Tags tests', TAP_CONF, function (t) {
    var testTags = require('./machines/tags');
    testTags(t, client, machine, function () {
        t.end();
    });
});


test('Metadata tests', TAP_CONF, function (t) {
    var testMetadata = require('./machines/metadata');
    testMetadata(t, client, machine, function () {
        t.end();
    });
});


test('Snapshots tests', TAP_CONF, function (t) {
    var testSnapshots = require('./machines/snapshots');
    testSnapshots(t, client, machine, function () {
        t.end();
    });
});


test('Firewall Rules tests', TAP_CONF, function (t) {
    var testFirewallRules = require('./machines/firewall-rules');
    testFirewallRules(t, client, machine, function () {
        t.end();
    });
});



test('Delete tests', TAP_CONF, function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, client, machine, function () {
        t.end();
    });
});


test('machine audit', TAP_CONF, function (t) {
    var p = '/my/machines/' + machine + '/audit';
    client.get(p, function (err, req, res, body) {
        t.ifError(err);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        var f = body.reverse()[0];
        t.ok(f.success);
        t.ok(f.time);
        t.ok(f.action);
        t.ok(f.caller);
        t.ok(f.caller.type);
        t.equal(f.caller.type, 'signature');
        t.ok(f.caller.ip);
        t.ok(f.caller.keyId);
        t.end();
    });
});


test('ListMachines tombstone', TAP_CONF, function (t) {
    client.get('/my/machines?tombstone=20', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'GET /my/machines body is array');
        t.ok(body.length, 'GET /my/machines list is not empty');
        t.ok(body.some(function (m) {
            return (m.id === machine);
        }));
        t.end();
    });
});


test('ListMachines exclude tombstone', TAP_CONF, function (t) {
    client.get('/my/machines', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'GET /my/machines body is array');
        t.notOk(body.some(function (m) {
            return (m.id === machine);
        }));
        t.end();
    });
});


test('Delete already deleted machine', TAP_CONF, function (t) {
    client.del('/my/machines/' + machine, function (err, req, res) {
        t.ok(err, 'DELETE /my/machines/ error');
        t.equal(res.statusCode, 410, 'DELETE /my/machines/ statusCode');
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


// Test using IMAGE.uuid instead of IMAGE.name due to PUBAPI-625:
test('CreateMachine (7.0)', TAP_CONF, function (t) {
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

    client.post({
        path: '/my/machines',
        headers: {
            'accept-version': '~7.0'
        }
    }, obj, function (err, req, res, body) {
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
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs ok');
        t.ok(jobs.length, 'list jobs is an array');
        waitForJob(client, jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});

test('Get Machine Firewall Enabled', TAP_CONF, function (t) {
    client.get('/my/machines/' + machine, function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines/:id error');
        t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines/:id body');
        checkMachine(t, body);
        t.ok(body.firewall_enabled);
        t.end();
    });
});


test('Delete 7.0.0 tests', TAP_CONF, function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, client, machine, function () {
        t.end();
    });
});


var LINUX_DS = false;
var KVM_MACHINE = false;

test('KVM dataset', TAP_CONF, function (t) {
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


test('Create KVM machine (7.0)', TAP_CONF, function (t) {
    if (LINUX_DS) {
        var obj = {
            image: LINUX_DS,
            'package': 'sdc_128_ok',
            name: 'a' + uuid().substr(0, 7),
            server_uuid: HEADNODE.uuid
        };
        client.post({
            path: '/my/machines',
            headers: {
                'accept-version': '~7.0'
            }
        }, obj, function (err, req, res, body) {
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



test('Wait For KVM machine Running', TAP_CONF,  function (t) {
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

test('Delete KVM tests', TAP_CONF, function (t) {
    if (KVM_MACHINE) {
        var deleteTest = require('./machines/delete');
        deleteTest(t, client, KVM_MACHINE, function () {
            t.end();
        });
    } else {
        t.end();
    }
});


test('teardown', TAP_CONF, function (t) {
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
