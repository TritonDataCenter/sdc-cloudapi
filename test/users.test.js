// Copyright 2014 Joyent, Inc.  All rights reserved.

var test = require('tap').test;

var libuuid = require('libuuid');
var util = require('util');
var common = require('./common');


// --- Globals

var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var SUB_FMT = 'uuid=%s, ' + USER_FMT;
var POLICY_FMT = 'policy-uuid=%s, ' + USER_FMT;
var GROUP_FMT = 'group-uuid=%s, ' + USER_FMT;

var client, server, account;
var SUB_ID = libuuid.create();
var SUB_LOGIN = 'a' + SUB_ID.substr(0, 7);
var SUB_EMAIL = SUB_LOGIN + '_test@joyent.com';
var SUB_UUID;
var SUB_DN;
var PWD = 'joypass123';

var SUB_ID_TWO = libuuid.create();
var SUB_LOGIN_TWO = 'a' + SUB_ID_TWO.substr(0, 7);
var SUB_EMAIL_TWO = SUB_LOGIN_TWO + '_test@joyent.com';
var SUB_UUID_TWO;
var SUB_DN_TWO;

var POLICY_DOC = [
    'Fred can read *.js when dirname = examples and sourceip = 10.0.0.0/8',
    'Bob can read and write timesheet if requesttime::time > 07:30:00 and ' +
        'requesttime::time < 18:30:00 and ' +
        'requesttime::day in (Mon, Tue, Wed, THu, Fri)',
    'John, Jack and Jane can ops_* *'
];

var POLICY_UUID, POLICY_DN, POLICY_NAME;

var GROUP_UUID, GROUP_DN, GROUP_NAME;

// --- Helpers
function checkUser(t, user) {
    t.ok(user, 'checkUser user OK');
    t.ok(user.id, 'checkUser user.id OK');
    t.ok(user.login, 'checkUser user.login OK');
    t.ok(user.email, 'checkUser user.email OK');
}

function checkPolicy(t, policy) {
    t.ok(policy, 'checkPolicy policy OK');
    t.ok(policy.id, 'checkPolicy policy.id OK');
    t.ok(policy.name, 'checkPolicy policy.name OK');
    t.ok(policy.rules, 'checkPolicy policy.rules OK');
}

function checkGroup(t, group) {
    t.ok(group, 'checkGroup group OK');
    t.ok(group.id, 'checkGroup group.id OK');
    t.ok(group.name, 'checkGroup group.name OK');
}


// --- Tests

test('setup', function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);
        client = _client;
        account = client.account;
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
        }
        server = _server;
        t.end();
    });
});


test('list users (empty) OK', function (t) {
    client.get('/my/users', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.equal(body.length, 0);
        t.end();
    });
});


test('create user with invalid login', function (t) {
    var user = {
        login: '_invalid_login',
        email: SUB_EMAIL,
        password: PWD
    };
    client.post('/my/users', user, function (err, req, res, body) {
        t.ok(err);
        t.ok(/login/.test(err.message));
        t.equal(err.name, 'InvalidArgumentError');
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('create user with invalid email', function (t) {
    var user = {
        login: SUB_LOGIN,
        email: 'foo+bar.com',
        password: PWD
    };
    client.post('/my/users', user, function (err, req, res, body) {
        t.ok(err);
        t.ok(/email/.test(err.message));
        t.equal(err.name, 'InvalidArgumentError');
        t.equal(res.statusCode, 409);
        t.end();
    });
});

test('create user without password', function (t) {
    var user = {
        login: SUB_LOGIN,
        email: SUB_EMAIL
    };
    client.post('/my/users', user, function (err, req, res, body) {
        t.ok(err);
        t.ok(/password/.test(err.message));
        t.equal(err.name, 'MissingParameterError');
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('create user', function (t) {
    var user = {
        login: SUB_LOGIN,
        email: SUB_EMAIL,
        password: PWD
    };

    client.post('/my/users', user, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkUser(t, body);
        SUB_UUID = body.id;
        SUB_DN = util.format(SUB_FMT, SUB_UUID, account.uuid);
        t.end();
    });
});


test('get user by login', function (t) {
    client.get('/my/users/' + SUB_LOGIN, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.id, SUB_UUID);
        t.end();
    });
});


test('update user', function (t) {
    client.post('/my/users/' + SUB_LOGIN, {
        phone: '+34 626 626 626'
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkUser(t, body);
        t.ok(body.phone);
        t.end();
    });
});


test('change password (missing params)', function (t) {
    client.post('/my/users/' + SUB_LOGIN + '/change_password', {
        password: 'whatever'
    }, function (err, req, res, body) {
        t.ok(err);
        t.ok(/password/.test(err.message));
        t.ok(body);
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('change password (confirmation missmatch)', function (t) {
    client.post('/my/users/' + SUB_LOGIN + '/change_password', {
        password: 'whatever',
        password_confirmation: 'somethingelse'
    }, function (err, req, res, body) {
        t.ok(err);
        t.ok(/password/.test(err.message));
        t.ok(body);
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('change password (OK)', function (t) {
    client.post('/my/users/' + SUB_LOGIN + '/change_password', {
        password: 'whatever123',
        password_confirmation: 'whatever123'
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkUser(t, body);
        t.end();
    });
});


test('get user by UUID', function (t) {
    client.get('/my/users/' + SUB_UUID, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.login, SUB_LOGIN);
        t.end();
    });
});


test('list users OK', function (t) {
    client.get('/my/users', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.equal(body.length, 1);
        t.end();
    });
});


test('create another user', function (t) {
    var user = {
        login: SUB_LOGIN_TWO,
        email: SUB_EMAIL_TWO,
        password: PWD
    };

    client.post('/my/users', user, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkUser(t, body);
        SUB_UUID_TWO = body.id;
        SUB_DN_TWO = util.format(SUB_FMT, SUB_UUID_TWO, account.uuid);
        t.end();
    });
});


test('list policies (empty)', function (t) {
    client.get('/my/policies', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.equal(body.length, 0);
        t.end();
    });
});


test('create policy', function (t) {
    var policy_uuid = libuuid.create();
    var name = 'a' + policy_uuid.substr(0, 7);

    var entry = {
        name: name,
        rules: POLICY_DOC,
        description: 'This is completely optional'
    };

    client.post('/my/policies', entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkPolicy(t, body);
        POLICY_UUID = body.id;
        POLICY_NAME = body.name;
        POLICY_DN = util.format(POLICY_FMT, POLICY_UUID, account.uuid);
        t.end();
    });
});


test('get policy by UUID', function (t) {
    client.get('/my/policies/' + POLICY_UUID, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.id, POLICY_UUID);
        t.end();
    });
});


test('get policy by name', function (t) {
    client.get('/my/policies/' + POLICY_NAME, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.id, POLICY_UUID);
        t.end();
    });
});


test('list policies (OK)', function (t) {
    client.get('/my/policies', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.equal(body.length, 1);
        t.end();
    });
});


test('update policy', function (t) {
    var str = 'Pedro can delete *';
    POLICY_DOC.push(str);
    client.post('/my/policies/' + POLICY_UUID, {
        rules: POLICY_DOC,
        name: 'policy-name-can-be-modified'
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkPolicy(t, body);
        t.equal(body.name, 'policy-name-can-be-modified');
        POLICY_NAME = body.name;
        t.ok(body.rules.indexOf(str) !== -1);
        t.end();
    });
});


test('list groups (empty)', function (t) {
    client.get('/my/groups', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.equal(body.length, 0);
        t.end();
    });
});


test('create group', function (t) {
    var group_uuid = libuuid.create();
    var name = 'a' + group_uuid.substr(0, 7);

    var entry = {
        name: name,
        members: SUB_LOGIN_TWO
    };

    client.post('/my/groups', entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkGroup(t, body);
        GROUP_UUID = body.id;
        GROUP_NAME = body.name;
        GROUP_DN = util.format(GROUP_FMT, GROUP_UUID, account.uuid);
        t.end();
    });
});


test('get group (by UUID)', function (t) {
    client.get('/my/groups/' + GROUP_UUID, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.id, GROUP_UUID);
        t.end();
    });
});


test('get group (by name)', function (t) {
    client.get('/my/groups/' + GROUP_NAME, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.id, GROUP_UUID);
        t.end();
    });
});


test('list groups (OK)', function (t) {
    client.get('/my/groups', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.equal(body.length, 1);
        t.end();
    });
});


test('update group', function (t) {
    var members = [SUB_LOGIN_TWO, SUB_LOGIN];
    client.post('/my/groups/' + GROUP_NAME, {
        members: members,
        name: 'group-name-can-be-modified'
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkGroup(t, body);
        t.equal(body.name, 'group-name-can-be-modified');
        GROUP_NAME = body.name;
        t.ok(body.members.indexOf(SUB_LOGIN) !== -1);
        t.end();
    });
});


test('add existing policy to group', function (t) {
    client.post('/my/groups/' + GROUP_NAME, {
        policies: [POLICY_NAME]
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkGroup(t, body);
        t.ok(body.policies.indexOf(POLICY_NAME) !== -1);
        t.end();
    });
});


test('add unexisting policy to group', function (t) {
    var FAKE_POLICY = libuuid.create();
    client.post('/my/groups/' + GROUP_NAME, {
        policies: [POLICY_NAME, FAKE_POLICY]
    }, function (err, req, res, body) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('get user by UUID', function (t) {
    client.get('/my/users/' + SUB_UUID, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.login, SUB_LOGIN);
        t.end();
    });
});


test('get user with roles', function (t) {
    client.get('/my/users/' + SUB_LOGIN + '?membership=true',
        function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.id, SUB_UUID);
        t.ok(body.roles);
        t.ok(Array.isArray(body.roles));
        t.end();
    });
});


test('delete group', function (t) {
    var url = '/my/groups/' + GROUP_UUID;
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});



test('delete policy', function (t) {
    var url = '/my/policies/' + POLICY_UUID;
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('delete user', function (t) {
    var url = '/my/users/' + SUB_LOGIN;
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('delete another user', function (t) {
    var url = '/my/users/' + SUB_LOGIN_TWO;
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('teardown', { timeout: 'Infinity' }, function (t) {
    function nuke(callback) {
        client.teardown(function (err) {
            if (err) {
                return setTimeout(function () {
                    return nuke(callback);
                }, 500);
            }

            return callback(null);
        });
    }

    return nuke(function (err) {
        t.ifError(err);
        if (!process.env.SDC_SETUP_TESTS) {
            server._clients.ufds.client.removeAllListeners('close');
            if (!server._clients.is_ufds_master) {
                server._clients.ufds_master.client.removeAllListeners('close');
            }
            server.close(function () {
                t.end();
            });
        } else {
            t.end();
        }
    });
});
