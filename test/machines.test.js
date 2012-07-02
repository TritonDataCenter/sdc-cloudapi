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
var TAP_CONF = {
    timeout: 'Infinity '
};

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
    t.ok(m.disk, 'checkMachine disk ok');
    t.ok(m.metadata, 'checkMachine metadata ok');
    t.ok(m.created, 'checkMachine created ok');
    t.ok(m.updated, 'checkMachine updated ok');
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
            return callback('Job failed');
        }

        return callback(null, (job ? job.execution === 'succeeded' : false));
    })
}


function waitForJob(uuid, callback) {
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
        t.ok(_server);
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
        name: 'a' + uuid().substr(0, 7),
        'metadata.foo': 'bar'
    };
    obj['tag.' + TAG_KEY] = TAG_VAL;

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ifError(err, 'POST /my/machines error');
        t.equal(res.statusCode, 201, 'POST /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'POST /my/machines body');
        checkMachine(t, body);
        machine = body.id;
        t.end();
    });
});


test('Wait For Running', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'provision'
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

/*
test('ListMachines by tag', function(t) {
    var url = '/my/machines?tag.' + TAG_KEY + '=' + TAG_VAL;
    client.get(url, function(err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        body.forEach(function(m) {
            checkMachine(t, m);
            machine = m.id;
        });
        t.end();
    });
});
*/

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


/*
test('ListTags', TAP_CONF, function(t) {
    var url = '/my/machines/' + machine + '/tags';
    client.get(url, function(err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(body[TAG_KEY]);
        t.equal(body[TAG_KEY], TAG_VAL);
        t.end();
    });
});


test('GetTag', TAP_CONF, function(t) {
    var path = '/my/machines/' + machine + '/tags/' + TAG_KEY;
    client.get(path, function(err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body, TAG_VAL);
        t.end();
    });
});


test('DeleteTag', TAP_CONF, function(t) {
    var url = '/my/machines/' + machine + '/tags/' + TAG_KEY;
    client.del(url, function(err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


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


test('teardown', TAP_CONF, function (t) {
    client.del('/my/keys/' + keyName, function (err, req, res) {
        t.ifError(err, 'delete key error');
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        client.teardown(function (err2) {
            // Ignore err2 here, just means we have not been able to remove
            // something from ufds.
            server.close(function () {
                t.end();
            });
        });
    });
});

