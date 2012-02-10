// Copyright 2012 Joyent, Inc.  All rights reserved.

var fs = require('fs');

var test = require('tap').test;
var uuid = require('node-uuid');

var common = require('./common');



///--- Globals

var client;
var keyName;
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



///--- Helpers

function checkMachine(t, machine) {
    t.ok(machine);
    t.ok(machine.id);
    t.ok(machine.name);
    t.ok(machine.type);
    t.ok(machine.state);
    t.ok(machine.dataset);
    t.ok(machine.ips);
    t.ok(machine.memory);
    t.ok(machine.disk);
    t.ok(machine.metadata);
    t.ok(machine.created);
    t.ok(machine.updated);
}


function checkSnapshot(t, snap) {
    t.ok(snap);
    t.ok(snap.name);
    t.ok(snap.state);
}


function checkState(url, state, callback) {
    return client.get(url, function(err, req, res, body) {
        if (err)
            return callback(err)

        return callback(null, (body ? body.state === state : false));
    });
}


function waitForState(url, state, callback) {
    return checkState(url, state, function(err, ready) {
        if (err)
            return callback(err);

        if (!ready)
            return setTimeout(function() {
                waitForState(url, state, callback);
            }, (process.env.POLL_INTERVAL || 500));

        return callback(null);
    });
}


///--- Tests

test('setup', TAP_CONF, function(t) {
    common.setup(function(err, _client) {
        t.ifError(err);
        t.ok(_client);
        client = _client;

        client.post('/my/keys', {key: KEY}, function(err, req, res, body) {
            t.ifError(err);
            keyName = body.name
            t.end();
        });
    });
});


test('ListMachines (empty)', TAP_CONF, function(t) {
    client.get('/my/machines', function(err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(!body.length);
        t.end();
    });
});


test('CreateMachine', TAP_CONF, function(t) {
    var obj = {
        dataset: 'smartos',
        'package': 'regular_128',
        name: 'a' + uuid().substr(0, 7),
        'metadata.foo': 'bar'
    };
    obj['tag.' + TAG_KEY] = TAG_VAL;

    client.post('/my/machines', obj, function(err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        checkMachine(t, body);
        t.end();
    });
});


// Do this here so that Riak has time to nuke it by teardown
test('delete ssh key', TAP_CONF, function(t) {
    var path = '/my/keys/' + encodeURIComponent(keyName);
    client.del(path, function(err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('ListMachines all', TAP_CONF, function(t) {
    client.get('/my/machines', function(err, req, res, body) {
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


test('Wait For Running', TAP_CONF,  function(t) {
    var url = '/my/machines/' + machine;
    waitForState(url, 'running', function(err) {
        t.ifError(err);
        t.end();
    });
});


test('StopMachine', TAP_CONF, function(t) {
    client.post('/my/machines/' + machine, {action: 'stop'}, function(err) {
        t.ifError(err);
        t.end();
    });
});


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
      client.del(url + '/' + s.name, function(err) {
        t.ifError(err);
        t.end();
      });
    });
  });
});


test('DeleteMachine', TAP_CONF, function(t) {
    client.del('/my/machines/' + machine, function(err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('teardown', TAP_CONF, function(t) {
    client.teardown(function(err) {
        t.ifError(err);
        t.end();
    });
});

