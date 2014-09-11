/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Tests for users, roles and policies resources.
 *
 * Note there is a default role/policy couple created by
 * test common during test setup.
 */

var test = require('tap').test;

var libuuid = require('libuuid');
var util = require('util');
var common = require('./common');


// --- Globals

var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var SUB_FMT = 'uuid=%s, ' + USER_FMT;
var POLICY_FMT = 'policy-uuid=%s, ' + USER_FMT;
var ROLE_FMT = 'role-uuid=%s, ' + USER_FMT;
var ADMIN_ROLE_NAME = 'administrator';

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
    'Fred can read *.js when foo::string = bar and ' +
    'tag::string = examples and ' +
    'sourceip::ip = 10.0.0.0/8',
    'Bob can read and write timesheet if requesttime::time > 07:30:00 and ' +
        'requesttime::time < 18:30:00 and ' +
        'requesttime::day in (Mon, Tue, Wed, THu, Fri)',
    'John, Jack and Jane can ops_* *'
];

var POLICY_UUID, POLICY_DN, POLICY_NAME;

var ROLE_UUID, ROLE_DN, ROLE_NAME;

var KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEAvad19ePSDckmgmo6Unqmd8' +
    'n2G7o1794VN3FazVhV09yooXIuUhA+7OmT7ChiHueayxSubgL2MrO/HvvF/GGVUs/t3e0u4' +
    '5YwRC51EVhyDuqthVJWjKrYxgDMbHru8fc1oV51l0bKdmvmJWbA/VyeJvstoX+eiSGT3Jge' +
    'egSMVtc= mark@foo.local';

var SSH_KEY_TWO = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDY2qV5e2q8qb+kYtn' +
'pvRxC5PM6aqPPgWcaXn2gm4jtefGAPuJX9fIkz/KTRRLxdG27IMt6hBXRXvL0Gzw0H0mSUPHAbq' +
'g4TAyG3/xEHp8iLH/QIf/RwVgjoGB0MLZn7q+L4ThMDo9rIrc5CpfOm/AN9vC4w0Zzu/XpJbzjd' +
'pTXOh+vmOKkiWCzN+BJ9DvX3iei5NFiSL3rpru0j4CUjBKchUg6X7mdv42g/ZdRT9rilmEP154F' +
'X/bVsFHitmyyYgba+X90uIR8KGLFZ4eWJNPprJFnCWXrpY5bSOgcS9aWVgCoH8sqHatNKUiQpZ4' +
'Lsqr+Z4fAf4enldx/KMW91iKn whatever@wherever.local';

var FP_ONE, FP_TWO;
var ADMIN_ROLE_ID;

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

function checkRole(t, role) {
    t.ok(role, 'checkRole role OK');
    t.ok(role.id, 'checkRole role.id OK');
    t.ok(role.name, 'checkRole role.name OK');
    if (role.members) {
        t.ok(Array.isArray(role.members), 'checkRole role.members');
    }
    if (role.policies) {
        t.ok(Array.isArray(role.policies), 'checkRole role.policies');
    }
}

function checkKey(t, key) {
    t.ok(key);
    t.ok(key.name);
    t.ok(key.key);
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
            server = _server;
        }
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


test('update user', function (t) {
    client.post('/my/users/' + SUB_UUID, {
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
    client.post('/my/users/' + SUB_UUID + '/change_password', {
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
    client.post('/my/users/' + SUB_UUID + '/change_password', {
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
    client.post('/my/users/' + SUB_UUID + '/change_password', {
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
        t.ifError(err, 'list users err');
        t.equal(res.statusCode, 200, 'list users status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'list users body');
        t.ok(Array.isArray(body), 'list users returns array');
        t.equal(body.length, 2, 'list users array length');
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


test('list policies (OK)', function (t) {
    client.get('/my/policies', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.equal(body.length, 2);
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


test('update policy with wrong rule', function (t) {
    var str = 'Pedro can delete * when baz = bar';
    POLICY_DOC.push(str);
    client.post('/my/policies/' + POLICY_UUID, {
        rules: POLICY_DOC,
        name: 'policy-name-can-be-modified'
    }, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.name, 'InvalidArgumentError');
        t.ok(body);
        t.ok(/baz/.test(body.message));
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('create role', function (t) {
    var role_uuid = libuuid.create();
    var name = 'a' + role_uuid.substr(0, 7);

    var entry = {
        name: name,
        members: SUB_LOGIN_TWO,
        default_members: SUB_LOGIN_TWO
    };

    client.post('/my/roles', entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkRole(t, body);
        ROLE_UUID = body.id;
        ROLE_NAME = body.name;
        ROLE_DN = util.format(ROLE_FMT, ROLE_UUID, account.uuid);
        t.end();
    });
});


test('get role (by UUID)', function (t) {
    client.get('/my/roles/' + ROLE_UUID, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.id, ROLE_UUID);
        t.end();
    });
});


test('update role', function (t) {
    var members = [SUB_LOGIN_TWO, SUB_LOGIN];
    client.post('/my/roles/' + ROLE_UUID, {
        members: members,
        default_members: [SUB_LOGIN],
        name: 'role-name-can-be-modified'
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkRole(t, body);
        t.equal(body.name, 'role-name-can-be-modified');
        ROLE_NAME = body.name;
        t.ok(body.members.indexOf(SUB_LOGIN) !== -1);
        t.ok(body.default_members.indexOf(SUB_LOGIN) !== -1);
        t.end();
    });
});


test('enable member role', function (t) {
    client.post('/my/roles/' + ROLE_UUID, {
        default_members: [SUB_LOGIN, SUB_LOGIN_TWO]
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkRole(t, body);
        t.ok(body.members.indexOf(SUB_LOGIN) !== -1);
        t.ok(body.default_members.indexOf(SUB_LOGIN) !== -1);
        t.ok(body.members.indexOf(SUB_LOGIN_TWO) !== -1);
        t.ok(body.default_members.indexOf(SUB_LOGIN_TWO) !== -1);
        t.end();
    });
});


test('add existing policy to role', function (t) {
    client.post('/my/roles/' + ROLE_UUID, {
        policies: [POLICY_NAME]
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkRole(t, body);
        t.ok(body.policies.indexOf(POLICY_NAME) !== -1);
        t.end();
    });
});


test('add unexisting policy to role', function (t) {
    var FAKE_POLICY = libuuid.create();
    client.post('/my/roles/' + ROLE_UUID, {
        policies: [POLICY_NAME, FAKE_POLICY]
    }, function (err, req, res, body) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('create another role', function (t) {
    var role_uuid = libuuid.create();
    var name = 'a' + role_uuid.substr(0, 7);

    var entry = {
        name: name,
        members: [SUB_LOGIN, SUB_LOGIN_TWO],
        policies: [POLICY_NAME]
    };

    client.post('/my/roles', entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkRole(t, body);
        t.end();
    });
});


test('list roles (OK)', function (t) {
    client.get('/my/roles', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.equal(body.length, 3);
        checkRole(t, body[0]);
        checkRole(t, body[1]);
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
    client.get('/my/users/' + SUB_UUID + '?membership=true',
        function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.id, SUB_UUID);
        t.ok(body.roles);
        t.ok(body.default_roles);
        t.ok(Array.isArray(body.roles));
        t.ok(Array.isArray(body.default_roles));
        t.end();
    });
});


test('add role to user resource', function (t) {
    var path = '/my/users/' + SUB_UUID;
    var role = client.role.name;

    client.put(path, {
        'role-tag': [role]
    }, function (err) {
        t.ifError(err);

        client.get(path, function (err2, req, res, body) {
            t.ifError(err2);
            t.equal(res.headers['role-tag'], role);
            t.end();
        });
    });
});


test('add role to non-existent user resource', function (t) {
    var badPath = '/my/users/d26f4257-a795-4a7e-a360-e5441b39def0';
    var role = client.role.name;

    client.put(badPath, {
        'role-tag': [role]
    }, function (err) {
        t.equivalent(err, {
            message: 'd26f4257-a795-4a7e-a360-e5441b39def0 does not exist',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'd26f4257-a795-4a7e-a360-e5441b39def0 does not exist'
            }
        });

        t.end();
    });
});


test('Attempt to create administrator role with policies fails', function (t) {
    var entry = {
        name: ADMIN_ROLE_NAME,
        members: [SUB_LOGIN, SUB_LOGIN_TWO],
        policies: [POLICY_NAME]
    };

    client.post('/my/roles', entry, function (err, req, res, body) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.ok(/administrator/i.test(body.message));
        t.end();
    });
});


test('Create administrator role', function (t) {
    var entry = {
        name: ADMIN_ROLE_NAME,
        members: [SUB_LOGIN, SUB_LOGIN_TWO]
    };

    client.post('/my/roles', entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkRole(t, body);
        ADMIN_ROLE_ID = body.id;
        t.end();
    });
});


test('Update administrator role with policies fails', function (t) {
    var entry = {
        name: ADMIN_ROLE_NAME,
        members: [SUB_LOGIN, SUB_LOGIN_TWO],
        policies: [POLICY_NAME]
    };

    client.post('/my/roles/' + ADMIN_ROLE_ID, entry,
        function (err, req, res, body) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.ok(/administrator/i.test(body.message));
        t.end();
    });
});


test('delete administrator role', function (t) {
    var url = '/my/roles/' + ADMIN_ROLE_ID;
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('ListKeys (empty) OK', function (t) {
    var p = util.format('/my/users/%s/keys', SUB_UUID);
    client.get(p, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.notOk(body.length);
        t.end();
    });
});


test('CreateKey (missing key)', function (t) {
    var p = util.format('/my/users/%s/keys', SUB_UUID);
    client.post(p, {}, function (err) {
        t.ok(err);
        t.equal(err.statusCode, 409);
        t.equal(err.restCode, 'MissingParameter');
        t.ok(err.message);
        t.end();
    });
});


test('CreateKey (named) OK', function (t) {
    var key = {
        key: KEY,
        name: 'id_rsa 1'
    };
    var p = util.format('/my/users/%s/keys', SUB_UUID);
    client.post(p, key, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkKey(t, body, 'CreateKey body');
        t.equal(body.name, key.name, 'CreateKey name');
        FP_ONE = body.fingerprint;
        client.get(p, function (err2, req2, res2, body2) {
            t.ifError(err2);
            t.equal(res2.statusCode, 200);
            common.checkHeaders(t, res2.headers);
            t.ok(body2);
            t.ok(body2.length);
            var key_present = false;
            body2.forEach(function (k) {
                if (k.name === key.name) {
                    key_present = true;
                }
                checkKey(t, k);
            });
            t.ok(key_present);
            t.end();
        });
    });
});


test('Create (named) key with duplicate name', function (t) {
    var key = {
        key: SSH_KEY_TWO,
        name: 'id_rsa 1'
    };
    var p = util.format('/my/users/%s/keys', SUB_UUID);
    client.post(p, key, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.statusCode, 409);
        t.end();
    });
});


test('Attempt to create with invalid key', function (t) {
    var key = {
        key: 'asdf',
        name: 'Not so valid'
    };
    var p = util.format('/my/users/%s/keys', SUB_UUID);
    client.post(p, key, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.statusCode, 409);
        t.equal(err.restCode, 'InvalidArgument');
        t.ok(err.message);
        t.end();
    });
});


test('ListKeys OK', function (t) {
    var p = util.format('/my/users/%s/keys', SUB_UUID);
    client.get(p, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(body.length);
        body.forEach(function (k) {
            checkKey(t, k);
        });
        t.end();
    });
});


test('GetKey OK', function (t) {
    var p = util.format('/my/users/%s/keys/', SUB_UUID);
    var url = p + encodeURIComponent(FP_ONE);
    client.get(url, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        checkKey(t, body);
        t.end();
    });
});


test('DeleteKey OK', function (t) {
    var p = util.format('/my/users/%s/keys/', SUB_UUID);
    var url = p + encodeURIComponent(FP_ONE);
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('delete role', function (t) {
    var url = '/my/roles/' + ROLE_UUID;
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
    var url = '/my/users/' + SUB_UUID;
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('delete another user', function (t) {
    var url = '/my/users/' + SUB_UUID_TWO;
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
