// Copyright 2012 Joyent, Inc. All rights reserved.

var fs = require('fs');
var util = require('util');
var test = require('tap').test;
var uuid = require('node-uuid');

var common = require('./common');



// --- Globals

var client, server;
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

var META_CREDS = [
    {
        username: 'root',
        password: 'secret'
    },
    {
        username: 'admin',
        password: 'secret'
    }
];

var TAP_CONF = {
    timeout: 'Infinity '
};

// May or not be created by previous test run or whatever else:
var sdc_256 = {
    name: 'sdc_256',
    version: '1.0.0',
    max_physical_memory: 256,
    quota: 10240,
    max_swap: 512,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    'default': false,
    vcpus: 1,
    urn: 'sdc::sdc_256:1.0.0',
    active: true
};

var sdc_256_entry;

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
    t.ok(snap);
    t.ok(snap.name);
    t.ok(snap.state);
}


// We cannot test vms provisioning neither status changes without querying
// jobs execution directly. Former approach of checking vms status changes
// assumes that jobs which may cause machine status changes will always
// succeed, which is not the case.
function checkJob(uuid, callback) {
    return client.vmapi.getJob(uuid, function (err, job) {
        if (err) {
            return callback(err);
        }

        if (job.execution === 'failed') {
            return callback(new Error('Job failed'));
        }

        return callback(null, (job ? job.execution === 'succeeded' : false));
    })
}


function waitForJob(uuid, callback) {
    // console.log('waiting for job with uuid: %s', uuid);
    return checkJob(uuid, function (err, ready) {
        if (err) {
            return callback(err);
        }
        if (!ready) {
            return setTimeout(function () {
                waitForJob(uuid, callback);
            }, (process.env.POLL_INTERVAL || 500));
        }
        return callback(null);
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

        client.post('/my/keys', {
            key: KEY,
            name: keyName
        }, function (err2, req, res, body) {
            t.ifError(err2, 'POST /my/keys error');
            t.end();
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


test('CreateMachine', TAP_CONF, function (t) {
    var obj = {
        dataset: 'smartos',
        'package': 'sdc_128',
        name: 'a' + uuid().substr(0, 7)
    };
    obj['metadata.' + META_KEY] = META_VAL;
    obj['tag.' + TAG_KEY] = TAG_VAL;

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ifError(err, 'POST /my/machines error');
        t.equal(res.statusCode, 201, 'POST /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'POST /my/machines body');
        checkMachine(t, body);
        machine = body.id;
        // Handy to output this to stdout in order to poke around COAL:
        console.log("Requested provision of machine: %s", machine);
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
        t.end();
    })
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


// We may have been created this on previous test suite runs or not:
test('Prepare resize package', TAP_CONF, function (t) {
    client.pkg.get(sdc_256.urn, function (err, pkg) {
        if (err) {
            if (err.restCode === 'ResourceNotFound') {
                // Try to create:
                client.pkg.add(sdc_256, function (err2, pkg2) {
                    t.ifError(err2, 'Error creating package');
                    t.ok(pkg2);
                    sdc_256_entry = pkg2;
                    t.end();
                });
            } else {
                t.ifError(err, 'Error fetching package');
                t.end();
            }
        } else {
            sdc_256_entry = pkg;
            t.end();
        }
    })
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
        console.log('Resize job: %j', resize_jobs[0]);
        waitForJob(resize_jobs[0].uuid, function (err2) {
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
        t.end();
    });
});


// TODO: Waiting to discuss why we cannot add anything else than strings,
// booleans and numbers to metadata.
/*
test('AddMetadataCredentials', TAP_CONF, function (t) {
    var path = '/my/machines/' + machine + '/metadata',
    tags = {};
    tags.credentials = META_CREDS;
    client.post(path, tags, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        console.log(body);
        t.ok(body.credentials);
        t.equal(body.credentials, META_CREDS);
        t.end();
    });
});
*/
// TODO: A good excuse to test credentials on GET /my/machines ... now!



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


test('DeleteAllMetadata', TAP_CONF, function (t) {
    var url = '/my/machines/' + machine + '/metadata';
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});



/*
test('Take Snapshot', TAP_CONF, function(t) {
    var url = '/my/machines/' + machine + '/snapshots';
    client.post(url, {}, function(err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        checkSnapshot(t, body);
        t.end();
    });
});


test('List Snapshots', TAP_CONF, function(t) {
    var url = '/my/machines/' + machine + '/snapshots';
    client.get(url, function(err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        body.forEach(function(s) {
            checkSnapshot(t, s);
        });
        t.end();
    });
});


// Blocked on PROV-1352, as is the commented out section above
test('Delete snapshot', TAP_CONF, function(t) {
  var url = '/my/machines/' + machine + '/snapshots';
  client.get(url, function(err, req, res, body) {
    t.ifError(err);
    body.forEach(function(s) {
      client.del(url + '/' + s.name, function(err2) {
        t.ifError(err2);
        t.end();
      });
    });
  });
});

*/


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
                server.close(function () {
                    t.end();
                });
            } else {
                t.end();
            }
        });
    });
});
