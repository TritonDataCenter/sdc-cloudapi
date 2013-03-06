// Copyright 2012 Joyent, Inc. All rights reserved.

var fs = require('fs');
var util = require('util');
var test = require('tap').test;
var uuid = require('node-uuid');
var sprintf = util.format;
var common = require('./common');



// --- Globals

var client, server, snapshot;
var keyName = uuid();
var machine;
var KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEAvad19ePSDckmgmo6Unqmd8' +
    'n2G7o1794VN3FazVhV09yooXIuUhA+7OmT7ChiHueayxSubgL2MrO/HvvF/GGVUs/t3e0u4' +
    '5YwRC51EVhyDuqthVJWjKrYxgDMbHru8fc1oV51l0bKdmvmJWbA/VyeJvstoX+eiSGT3Jge' +
    'egSMVtc= mark@foo.local';

var TAG_KEY = 'role';
var TAG_VAL = 'unitTest';

var TAG_TWO_KEY = 'smartdc_type';
var TAG_TWO_VAL = 'none';

var META_KEY = 'foo';
var META_VAL = 'bar';

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


var sdc_256_entry, sdc_256_inactive_entry;

var HEADNODE = null;

// --- Helpers

function checkMachine(t, m) {
    t.ok(m, 'checkMachine ok');
    t.ok(m.id, 'checkMachine id ok');
    t.ok(m.name, 'checkMachine name ok');
    t.ok(m.type, 'checkMachine type ok');
    t.ok(m.state, 'checkMachine state ok');
    t.ok(m.dataset, 'checkMachine dataset ok');
    t.ok(m.ips, 'checkMachine ips ok');
    t.ok(m.memory, 'checkMachine memory ok');
    t.ok(m.metadata, 'checkMachine metadata ok');
    t.ok(m['package'], 'checkMachine package ok');
    // TODO:
    // Intentionally making disk, which is zero first, and created/updated,
    // which are not set at the beginning, fail until we decide how to proceed
    // t.ok(m.disk, 'checkMachine disk ok');
    // t.ok(m.created, 'checkMachine created ok');
    // t.ok(m.updated, 'checkMachine updated ok');
    t.ok(typeof (m.disk) !== 'undefined');
    t.ok(typeof (m.created) !== 'undefined');
    t.ok(typeof (m.updated) !== 'undefined');
}


function checkSnapshot(t, snap) {
    t.ok(snap, 'snapshot ok');
    t.ok(snap.name, 'snapshot name ok');
    t.ok(snap.state, 'snapshot state ok');
}


// We cannot test vms provisioning neither status changes without querying
// jobs execution directly. Former approach of checking vms status changes
// assumes that jobs which may cause machine status changes will always
// succeed, which is not the case.
function checkJob(id, callback) {
    return client.vmapi.getJob(id, function (err, job) {
        if (err) {
            return callback(err);
        }

        if (job.execution === 'failed') {
            return callback(new Error('Job failed'));
        }

        return callback(null, (job ? job.execution === 'succeeded' : false));
    });
}


function waitForJob(id, callback) {
    // console.log('waiting for job with uuid: %s', uuid);
    return checkJob(id, function (err, ready) {
        if (err) {
            return callback(err);
        }
        if (!ready) {
            return setTimeout(function () {
                waitForJob(id, callback);
            }, (process.env.POLL_INTERVAL || 500));
        }
        return callback(null);
    });
}


function saveKey(t, cb) {
    return client.post('/my/keys', {
        key: KEY,
        name: keyName
    }, function (err2, req, res, body) {
        t.ifError(err2, 'POST /my/keys error');
        return cb();
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

        saveKey(t, function () {
            // We may have been created this on previous test suite runs or not:
            client.pkg.list(function (err3, packages) {
                if (err3) {
                    t.ifError(err3, 'Error fetching packages');
                    t.end();
                } else {
                    sdc_256_entry = packages.filter(function (p) {
                        return (p.name === 'sdc_256');
                    })[0];
                    client.pkg.get(sdc_256_inactive.urn, function (err4, pkg) {
                        if (err4) {
                            if (err4.restCode === 'ResourceNotFound') {
                                client.pkg.add(sdc_256_inactive,
                                    function (err5, pkg2) {
                                        t.ifError(err5,
                                            'Error creating package');
                                        t.ok(pkg2, 'Package created OK');
                                        sdc_256_inactive_entry = pkg2;
                                        t.end();
                                    });
                            } else {
                                t.ifError(err4, 'Error fetching package');
                                t.end();
                            }

                        } else {
                            sdc_256_inactive_entry = pkg;
                            t.end();
                        }
                    });

                }
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


test('CreateMachine (6.5)', TAP_CONF, function (t) {
    var obj = {
        dataset: 'smartos',
        'package': 'sdc_128',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid
    };
    obj['metadata.' + META_KEY] = META_VAL;
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
        waitForJob(jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('Create machine with inactive package', function (t) {
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
        t.ok(err, 'POST /my/machines with inactive pacakge error');
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('CreateMachine (7.0) w/o dataset fails', TAP_CONF, function (t) {
    var obj = {
        'package': 'sdc_128',
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


test('Get Machine', function (t) {
    client.get('/my/machines/' + machine, function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines/:id error');
        t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines/:id body');
        checkMachine(t, body);
        // Double check tags are OK, due to different handling by VMAPI:
        var tags = {};
        tags[TAG_KEY] = TAG_VAL;
        t.equivalent(body.tags, tags);
        // Make sure we are not including credentials:
        t.equal(typeof (body.metadata.credentials), 'undefined');
        t.end();
    });
});


test('Get Machine Include Credentials', function (t) {
    var url = '/my/machines/' + machine + '?credentials=true';
    client.get(url, function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines/:id error');
        t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines/:id body');
        checkMachine(t, body);
        t.equal(typeof (body.metadata.credentials), 'object');
        Object.keys(META_CREDS).forEach(function (k) {
            t.equal(body.metadata.credentials[k + '_pw'], META_CREDS[k]);
        });
        t.end();
    });
});


test('ListMachines by tag', function (t) {
    var url = '/my/machines?tag.' + TAG_KEY + '=' + TAG_VAL;
    client.get(url, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        body.forEach(function (m) {
            checkMachine(t, m);
            machine = m.id;
        });
        t.end();
    });
});


test('ListMachines all tagged machines', function (t) {
    var url = '/my/machines?tags=*';
    client.get(url, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        body.forEach(function (m) {
            checkMachine(t, m);
            machine = m.id;
        });
        t.end();
    });
});


// This is to make sure we're not getting machines from a different customer
// when searching by tags:
test('Attempt to list other owner machines by tag', function (t) {
    // Admin user will always have all of the HN zones with this tag:
    var url = '/my/machines?tag.smartdc_type=core';
    client.get(url, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.equal(0, body.length);
        t.end();
    });
});


test('StopMachine', TAP_CONF, function (t) {
    client.post('/my/machines/' + machine, {
        action: 'stop'
    }, function (err) {
        t.ifError(err);
        t.end();
    });
});


test('Wait For Stopped', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'stop'
    }, function (err, jobs) {
        t.ifError(err, 'list jobs error');
        t.ok(jobs);
        t.ok(jobs.length);
        waitForJob(jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('StartMachine', TAP_CONF, function (t) {
    client.post('/my/machines/' + machine, {
        action: 'start'
    }, function (err) {
        t.ifError(err);
        t.end();
    });
});


test('Wait For Started', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'start'
    }, function (err, jobs) {
        t.ifError(err, 'list jobs error');
        t.ok(jobs);
        t.ok(jobs.length);
        waitForJob(jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('RebootMachine', TAP_CONF, function (t) {
    client.post('/my/machines/' + machine, {
        action: 'reboot'
    }, function (err) {
        t.ifError(err);
        t.end();
    });
});


test('Wait For Rebooted', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'reboot'
    }, function (err, jobs) {
        t.ifError(err, 'list jobs error');
        t.ok(jobs);
        t.ok(jobs.length);
        waitForJob(jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('Resize machine to inactive package', function (t) {
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
    t.ok(sdc_256_entry, 'Resize package OK');
    console.log('Resizing to package: %j', sdc_256_entry);
    client.post('/my/machines/' + machine, {
        action: 'resize',
        'package': sdc_256_entry.name
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
        waitForJob(resize_jobs[0].uuid, function (err2) {
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
        waitForJob(rename_jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('ListTags', TAP_CONF, function (t) {
    var url = '/my/machines/' + machine + '/tags';
    client.get(url, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(body[TAG_KEY]);
        t.equal(body[TAG_KEY], TAG_VAL);
        t.end();
    });
});


test('AddTag', TAP_CONF, function (t) {
    var path = '/my/machines/' + machine + '/tags',
    tags = {};
    tags[TAG_TWO_KEY] = TAG_TWO_VAL;
    client.post(path, tags, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(body[TAG_TWO_KEY]);
        t.equal(body[TAG_TWO_KEY], TAG_TWO_VAL);
        t.end();
    });
});


test('GetTag', TAP_CONF, function (t) {
    var path = '/my/machines/' + machine + '/tags/' + TAG_KEY;
    client.get(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body, TAG_VAL);
        t.end();
    });
});


test('DeleteTag', TAP_CONF, function (t) {
    var url = '/my/machines/' + machine + '/tags/' + TAG_KEY;
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('ReplaceTags', TAP_CONF, function (t) {
    var path = '/my/machines/' + machine + '/tags',
    tags = {};
    tags[TAG_KEY] = TAG_VAL;
    client.put(path, tags, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(body[TAG_KEY]);
        t.equal(body[TAG_KEY], TAG_VAL);
        t.equal(typeof (body[TAG_TWO_KEY]), 'undefined');
        t.end();
    });

});


test('DeleteAllTags', TAP_CONF, function (t) {
    var url = '/my/machines/' + machine + '/tags';
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('ListMetadata', TAP_CONF, function (t) {
    var url = '/my/machines/' + machine + '/metadata';
    client.get(url, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(body[META_KEY]);
        t.equal(body[META_KEY], META_VAL);
        t.equal(typeof (body.credentials), 'undefined');
        t.end();
    });
});


test('AddMetadataCredentials', TAP_CONF, function (t) {
    var path = '/my/machines/' + machine + '/metadata',
    meta = {};
    meta.credentials = JSON.stringify(META_CREDS_TWO);
    client.post(path, meta, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(typeof (body.credentials), 'undefined');
        t.end();
    });
});


test('Wait For Credentials Job', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'update'
    }, function (err, jobs) {
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs OK');
        t.ok(jobs.length, 'update jobs is array');
        var cred_jobs = jobs.filter(function (job) {
            return (
                typeof (job.params.set_customer_metadata) !==
                'undefined' &&
                typeof (job.params.set_customer_metadata.credentials) !==
                'undefined');
        });
        t.ok(cred_jobs.length, 'credentials jobs is an array');
        waitForJob(cred_jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('Get Machine Include Credentials', function (t) {
    var url = '/my/machines/' + machine + '?credentials=true';
    client.get(url, function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines/:id error');
        t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines/:id body');
        checkMachine(t, body);
        t.equal(typeof (body.metadata.credentials), 'object');
        //Object.keys(META_CREDS_TWO).forEach(function (k) {
        //    t.equal(body.metadata.credentials[k + '_pw'], META_CREDS_TWO[k]);
        //});
        t.end();
    });
});


test('AddMetadata', TAP_CONF, function (t) {
    var path = '/my/machines/' + machine + '/metadata',
    meta = {
        bar: 'baz'
    };
    client.post(path, meta, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(body.bar);
        t.end();
    });
});


test('GetMetadata', TAP_CONF, function (t) {
    var path = '/my/machines/' + machine + '/metadata/' + META_KEY;
    client.get(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body, META_VAL);
        t.end();
    });
});


test('DeleteMetadata', TAP_CONF, function (t) {
    var url = '/my/machines/' + machine + '/metadata/' + META_KEY;
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('DeleteMetadataCredentials', TAP_CONF, function (t) {
    var url = '/my/machines/' + machine + '/metadata/credentials';
    client.del(url, function (err, req, res) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('DeleteAllMetadata', TAP_CONF, function (t) {
    var url = '/my/machines/' + machine + '/metadata';
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('Take Snapshot', TAP_CONF, function (t) {
    var url = '/my/machines/' + machine + '/snapshots';
    client.post(url, {}, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        checkSnapshot(t, body);
        snapshot = body;
        t.end();
    });
});


test('Wait For Snapshot', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'snapshot'
    }, function (err, jobs) {
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs OK');
        t.ok(jobs.length, 'update jobs is array');
        var snapshot_jobs = jobs.filter(function (job) {
            return (job.params.action === 'create_snapshot');
        });
        t.ok(snapshot_jobs.length, 'snapshot jobs is an array');
        waitForJob(snapshot_jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('List Snapshots', TAP_CONF, function (t) {
    var url = '/my/machines/' + machine + '/snapshots';
    client.get(url, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body, 'snapshots body');
        t.ok(Array.isArray(body), 'snapshots is an array');
        t.ok(body.length, 'there are snapshots');
        body.forEach(function (s) {
            checkSnapshot(t, s);
        });
        t.end();
    });
});


test('Get Snapshot', TAP_CONF, function (t) {
    t.ok(snapshot.name, 'Snapshot name OK');
    var url = '/my/machines/' + machine + '/snapshots/' + snapshot.name;
    client.get(url, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body, 'snapshot body');
        checkSnapshot(t, body);
        t.end();
    });
});


test('Rollback Snapshot', TAP_CONF, function (t) {
    t.ok(snapshot.name, 'Snapshot name OK');
    var url = '/my/machines/' + machine + '/snapshots/' + snapshot.name;
    client.post(url, {}, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 202);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('Wait For Snapshot Rollback', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'snapshot'
    }, function (err, jobs) {
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs OK');
        t.ok(jobs.length, 'update jobs is array');
        var snapshot_jobs = jobs.filter(function (job) {
            return (job.params.action === 'rollback_snapshot');
        });
        t.ok(snapshot_jobs.length, 'snapshot jobs is an array');
        console.log(util.inspect(snapshot_jobs, false, 8));
        waitForJob(snapshot_jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('Delete snapshot', TAP_CONF, function (t) {
    t.ok(snapshot.name, 'Snapshot name OK');
    var url = '/my/machines/' + machine + '/snapshots/' + snapshot.name;
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('Wait For Deleted Snapshot', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'snapshot'
    }, function (err, jobs) {
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs OK');
        t.ok(jobs.length, 'update jobs is array');
        var snapshot_jobs = jobs.filter(function (job) {
            return (job.params.action === 'delete_snapshot');
        });
        t.ok(snapshot_jobs.length, 'snapshot jobs is an array');
        waitForJob(snapshot_jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


// FireWall Rules:
var RULE_UUID;
var RULES_URL = '/my/fwrules';
var RULE_URL = RULES_URL + '/%s';
var RULE_JOB_UUID;

function checkRule(t, rule) {
    t.ok(rule.id, 'rule id ok');
    t.ok(rule.rule, 'rule text ok');
    t.ok(typeof (rule.enabled) !== 'undefined', 'rule enabled defined');
}


test('ListRules (empty set)', function (t) {
    client.get(RULES_URL, function (err, req, res, body) {
        t.ifError(err, 'Error');
        t.equal(200, res.statusCode, 'Status Code');
        t.ok(Array.isArray(body), 'isArray(body)');
        t.equal(body.length, 0, 'empty array');
        t.end();
    });
});


test('AddRule', function (t) {
    client.post(RULES_URL, {
        rule: 'FROM vm ' + machine +
            ' TO subnet 10.99.99.0/24 ALLOW tcp port 80'
    }, function (err, req, res, body) {
        t.ifError(err, 'Error');
        t.ok(body, 'body OK');
        checkRule(t, body);
        RULE_UUID = body.id;
        t.equal(201, res.statusCode, 'Status Code');
        t.equal(body.enabled, false, 'rule enabled');
        t.ok(res.headers['x-joyent-jobid'], 'jobid header');
        RULE_JOB_UUID = res.headers['x-joyent-jobid'];
        t.end();
    });
});


function checkWfJob(id, callback) {
    return client.wfapi.get(sprintf('/jobs/%s', id),
                            function (err, req, res, job) {
        if (err) {
            return callback(err);
        }

        if (job.execution === 'failed') {
            return callback(new Error('Job failed'));
        }

        return callback(null, (job ? job.execution === 'succeeded' : false));
    });
}


function waitForWfJob(id, callback) {
    // console.log('waiting for job with uuid: %s', id);
    return checkWfJob(id, function (err, ready) {
        if (err) {
            return callback(err);
        }
        if (!ready) {
            return setTimeout(function () {
                waitForWfJob(id, callback);
            }, (process.env.POLL_INTERVAL || 500));
        }
        return callback(null);
    });
}


test('RuleAdd Job', TAP_CONF, function (t) {
    waitForWfJob(RULE_JOB_UUID, function (err) {
        t.ifError(err, 'error');
        t.end();
    });
});


test('ListRules (not empty set)', TAP_CONF, function (t) {
    client.get(RULES_URL, function (err, req, res, body) {
        t.ifError(err, 'Error');
        t.equal(200, res.statusCode, 'Status Code');
        t.ok(Array.isArray(body), 'isArray(rules)');
        t.ok(body.length, 'rules length');
        checkRule(t, body[0]);
        t.end();
    });
});


test('List Rule Machines (not empty set)', TAP_CONF, function (t) {
    client.get(sprintf(RULE_URL, RULE_UUID) + '/machines', function (err, req, res, body) {
        t.ifError(err, 'Error');
        t.equal(200, res.statusCode, 'Status Code');
        t.ok(Array.isArray(body), 'isArray(machines)');
        t.ok(body.length, 'machines length');
        body.forEach(function (m) {
            checkMachine(t, m);
        });
        t.end();
    });
});


test('List Machine Rules (not empty set)', TAP_CONF, function (t) {
    var u = '/my/machines/' + machine + '/fwrules';
    client.get(u, function (err, req, res, body) {
        t.ifError(err, 'Error');
        t.equal(200, res.statusCode, 'Status Code');
        t.ok(Array.isArray(body), 'isArray(rules)');
        t.ok(body.length, 'rules length');
        checkRule(t, body[0]);
        t.end();
    });
});


test('GetRule', function (t) {
    client.get(sprintf(RULE_URL, RULE_UUID), function (err, req, res, body) {
        t.ifError(err);
        t.equal(200, res.statusCode);
        checkRule(t, body);
        t.end();
    });
});


test('UpdateRule', function (t) {
    client.post(sprintf(RULE_URL, RULE_UUID), {
        rule: 'FROM vm ' + machine +
            ' TO subnet 10.99.99.0/24 ALLOW tcp (port 80 AND port 443)'
    }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(200, res.statusCode);
        t.ok(res.headers['x-joyent-jobid'], 'jobid header');
        RULE_JOB_UUID = res.headers['x-joyent-jobid'];
        t.end();
    });
});


test('RuleUpdate Job', TAP_CONF, function (t) {
    waitForWfJob(RULE_JOB_UUID, function (err) {
        t.ifError(err, 'error');
        t.end();
    });
});


test('GetUpdatedRule', function (t) {
    client.get(sprintf(RULE_URL, RULE_UUID), function (err, req, res, body) {
        t.ifError(err);
        t.equal(200, res.statusCode);
        checkRule(t, body);
        t.end();
    });
});


test('EnableRule', function (t) {
    client.post(sprintf(RULE_URL, RULE_UUID) + '/enable', {
    }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(200, res.statusCode);
        t.ok(res.headers['x-joyent-jobid'], 'jobid header');
        RULE_JOB_UUID = res.headers['x-joyent-jobid'];
        t.end();
    });
});


test('EnableRule Job', TAP_CONF, function (t) {
    waitForWfJob(RULE_JOB_UUID, function (err) {
        t.ifError(err, 'error');
        t.end();
    });
});


test('GetEnabledRule', function (t) {
    client.get(sprintf(RULE_URL, RULE_UUID), function (err, req, res, body) {
        t.ifError(err);
        t.equal(200, res.statusCode);
        checkRule(t, body);
        t.end();
    });
});


test('DeleteRule', function (t) {
    client.del(sprintf(RULE_URL, RULE_UUID), function (err, req, res) {
        t.ifError(err);
        t.equal(204, res.statusCode);
        t.ok(res.headers['x-joyent-jobid'], 'jobid header');
        RULE_JOB_UUID = res.headers['x-joyent-jobid'];
        t.end();
    });
});


test('DeleteMachine', TAP_CONF, function (t) {
    client.del('/my/machines/' + machine, function (err, req, res) {
        t.ifError(err, 'DELETE /my/machines error');
        t.equal(res.statusCode, 204, 'DELETE /my/machines status');
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('Wait For Destroyed', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'destroy'
    }, function (err, jobs) {
        t.ifError(err, 'list jobs error');
        t.ok(jobs);
        t.ok(jobs.length);
        waitForJob(jobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
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
                server.close(function () {
                    t.end();
                });
            } else {
                t.end();
            }
        });
    });
});
