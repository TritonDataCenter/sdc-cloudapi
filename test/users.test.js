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

var test = require('tape').test;
var libuuid = require('libuuid');
var util = require('util');
var common = require('./common');

var checkNotFound = common.checkNotFound;
var checkInvalidArgument = common.checkInvalidArgument;


// --- Globals


var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var SUB_FMT = 'uuid=%s, ' + USER_FMT;
var ADMIN_ROLE_NAME = 'administrator';

var SUB_ID = libuuid.create();
var SUB_LOGIN = 'a' + SUB_ID.substr(0, 7);
var SUB_EMAIL = SUB_LOGIN + '_test@joyent.com';
var SUB_USER;

var PWD = 'joypass123';

var SUB_ID_2 = libuuid.create();
var SUB_LOGIN_2 = 'a' + SUB_ID_2.substr(0, 7);
var SUB_EMAIL_2 = SUB_LOGIN_2 + '_test@joyent.com';
var SUB_USER_2;

var POLICY_DOC = [
    'Fred can read *.js when foo::string = bar and ' +
    'tag::string = examples and ' +
    'sourceip::ip = 10.0.0.0/8',
    'Bob can read and write timesheet if requesttime::time > 07:30:00 and ' +
        'requesttime::time < 18:30:00 and ' +
        'requesttime::day in (Mon, Tue, Wed, THu, Fri)',
    'John, Jack and Jane can ops_* *'
];

var KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEAvad19ePSDckmgmo6Unqmd8' +
    'n2G7o1794VN3FazVhV09yooXIuUhA+7OmT7ChiHueayxSubgL2MrO/HvvF/GGVUs/t3e0u4' +
    '5YwRC51EVhyDuqthVJWjKrYxgDMbHru8fc1oV51l0bKdmvmJWbA/VyeJvstoX+eiSGT3Jge' +
    'egSMVtc= mark@foo.local';

var KEY_2 = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDY2qV5e2q8qb+kYtn' +
    'pvRxC5PM6aqPPgWcaXn2gm4jtefGAPuJX9fIkz/KTRRLxdG27IMt6hBXRXvL0Gzw0H0mSUP' +
    'HAbqg4TAyG3/xEHp8iLH/QIf/RwVgjoGB0MLZn7q+L4ThMDo9rIrc5CpfOm/AN9vC4w0Zzu' +
    '/XpJbzjdpTXOh+vmOKkiWCzN+BJ9DvX3iei5NFiSL3rpru0j4CUjBKchUg6X7mdv42g/ZdR' +
    'T9rilmEP154FX/bVsFHitmyyYgba+X90uIR8KGLFZ4eWJNPprJFnCWXrpY5bSOgcS9aWVgC' +
    'oH8sqHatNKUiQpZ4Lsqr+Z4fAf4enldx/KMW91iKn whatever@wherever.local';

var FINGERPRINT;

var ADMIN_ROLE_ID;

var POLICY_UUID;
var POLICY_NAME;

var ROLE_UUID;
var ROLE_NAME;
var ROLE_UUID_2;

var CLIENTS;
var CLIENT;
var SUB_CLIENT;
var OTHER;
var SERVER;


// --- Helpers


function checkUser(t, givenUser, expectedUser) {
    t.ok(givenUser, 'checkUser user OK');
    t.ok(givenUser.id, 'checkUser user.id OK');
    t.ok(givenUser.login, 'checkUser user.login OK');
    t.ok(givenUser.email, 'checkUser user.email OK');

    if (expectedUser) {
        t.equal(givenUser.login, expectedUser.login);
        t.equal(givenUser.email, expectedUser.email);

        if (expectedUser.id) {
            t.equal(givenUser.id, expectedUser.id);
        }
    }
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
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        SUB_CLIENT = clients.subuser;
        OTHER   = clients.other;
        SERVER  = server;

        t.end();
    });
});


test('create user with invalid login', function (t) {
    var user = {
        login: '_invalid_login',
        email: SUB_EMAIL,
        password: PWD
    };

    CLIENT.post('/my/users', user, function (err, req, res, body) {
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

    CLIENT.post('/my/users', user, function (err, req, res, body) {
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

    CLIENT.post('/my/users', user, function (err, req, res, body) {
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

    CLIENT.post('/my/users', user, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkUser(t, body, user);

        SUB_USER = body;

        t.end();
    });
});


test('update user', function (t) {
    var phoneNum = '+34 626 626 626';
    CLIENT.post('/my/users/' + SUB_USER.id, {
        phone: phoneNum
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkUser(t, body, SUB_USER);
        t.equal(body.phone, phoneNum);
        t.end();
    });
});


test('update user - other', function (t) {
    var phoneNum = '+34 626 626 626';
    OTHER.post('/my/users/' + SUB_USER.id, {
        phone: phoneNum
    }, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('change password (missing params)', function (t) {
    CLIENT.post('/my/users/' + SUB_USER.id + '/change_password', {
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
    CLIENT.post('/my/users/' + SUB_USER.id + '/change_password', {
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
    CLIENT.post('/my/users/' + SUB_USER.id + '/change_password', {
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


test('change password - other', function (t) {
    OTHER.post('/my/users/' + SUB_USER.id + '/change_password', {
        password: 'whatever123',
        password_confirmation: 'whatever123'
    }, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('get user by UUID', function (t) {
    CLIENT.get('/my/users/' + SUB_USER.id, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.login, SUB_LOGIN);
        t.end();
    });
});


test('get user by UUID - other', function (t) {
    OTHER.get('/my/users/' + SUB_USER.id, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('get user with roles', function (t) {
    CLIENT.get('/my/users/' + SUB_USER.id + '?membership=true',
        function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.id, SUB_USER.id);
        t.ok(body.roles);
        t.ok(body.default_roles);
        t.ok(Array.isArray(body.roles));
        t.ok(Array.isArray(body.default_roles));
        t.end();
    });
});


test('list users OK', function (t) {
    CLIENT.get('/my/users', function (err, req, res, body) {
        t.ifError(err, 'list users err');
        t.equal(res.statusCode, 200, 'list users status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'list users body');
        t.ok(Array.isArray(body), 'list users returns array');
        t.equal(body.length, 2, 'list users array length');

        var expectedUuids = [SUB_USER.id, SUB_CLIENT.account.uuid];
        t.notEqual(expectedUuids, body[0].id);
        t.notEqual(expectedUuids, body[1].id);

        t.end();
    });
});


test('create another user', function (t) {
    var user = {
        login: SUB_LOGIN_2,
        email: SUB_EMAIL_2,
        password: PWD
    };

    CLIENT.post('/my/users', user, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkUser(t, body);

        SUB_USER_2 = body;

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

    CLIENT.post('/my/policies', entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkPolicy(t, body);

        POLICY_UUID = body.id;
        POLICY_NAME = body.name;

        t.end();
    });
});


test('get policy by UUID', function (t) {
    CLIENT.get('/my/policies/' + POLICY_UUID, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.id, POLICY_UUID);
        t.end();
    });
});


test('get policy by UUID - other', function (t) {
    OTHER.get('/my/policies/' + POLICY_UUID, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('list policies (OK)', function (t) {
    CLIENT.get('/my/policies', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.equal(body.length, 2);

        var expectedUuids = [POLICY_UUID, CLIENT.policy.uuid];
        t.notEqual(expectedUuids, body[0].id);
        t.notEqual(expectedUuids, body[1].id);

        t.end();
    });
});


test('list policies - other', function (t) {
    OTHER.get('/my/policies', function (err, req, res, body) {
        t.ifError(err);
        t.deepEqual(body, []);
        t.end();
    });
});


test('update policy', function (t) {
    var str = 'Pedro can delete *';
    POLICY_DOC.push(str);

    CLIENT.post('/my/policies/' + POLICY_UUID, {
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


test('update policy - other', function (t) {
    OTHER.post('/my/policies/' + POLICY_UUID, {
        rules: POLICY_DOC,
        name: 'this-update-should-fail'
    }, function (err, req, res, body) {
        // XXX should be not found
        //checkNotFound(t, err, req, res, body);

        t.ok(err);
        t.ok(body);

        t.equal(err.restCode, 'MissingParameter');
        t.ok(err.message);

        t.equal(body.code, 'MissingParameter');
        t.ok(body.message);

        t.equal(res.statusCode, 409);

        t.end();
    });
});


test('update policy with wrong rule', function (t) {
    var str = 'Pedro can delete * when baz = bar';
    POLICY_DOC.push(str);

    CLIENT.post('/my/policies/' + POLICY_UUID, {
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
        members: SUB_LOGIN_2,
        default_members: SUB_LOGIN_2
    };

    CLIENT.post('/my/roles', entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkRole(t, body);

        ROLE_UUID = body.id;
        ROLE_NAME = body.name;

        t.end();
    });
});


test('create role - other', function (t) {
    var role_uuid = libuuid.create();
    var name = 'a' + role_uuid.substr(0, 7);

    var entry = {
        name: name,
        members: SUB_LOGIN_2,
        default_members: SUB_LOGIN_2
    };

    OTHER.post('/my/roles', entry, function (err, req, res, body) {
        checkInvalidArgument(t, err, req, res, body);
        t.end();
    });
});


test('get role (by UUID)', function (t) {
    CLIENT.get('/my/roles/' + ROLE_UUID, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.id, ROLE_UUID);
        t.end();
    });
});


test('get role (by UUID) - other', function (t) {
    OTHER.get('/my/roles/' + ROLE_UUID, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('update role', function (t) {
    var members = [SUB_LOGIN_2, SUB_LOGIN];

    CLIENT.post('/my/roles/' + ROLE_UUID, {
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


test('update role - other', function (t) {
    var members = [SUB_LOGIN_2, SUB_LOGIN];

    OTHER.post('/my/roles/' + ROLE_UUID, {
        members: members,
        default_members: [SUB_LOGIN],
        name: 'should-not-update'
    }, function (err, req, res, body) {
        checkInvalidArgument(t, err, req, res, body);
        t.end();
    });
});


test('enable member role', function (t) {
    CLIENT.post('/my/roles/' + ROLE_UUID, {
        default_members: [SUB_LOGIN, SUB_LOGIN_2]
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkRole(t, body);
        t.ok(body.members.indexOf(SUB_LOGIN) !== -1);
        t.ok(body.default_members.indexOf(SUB_LOGIN) !== -1);
        t.ok(body.members.indexOf(SUB_LOGIN_2) !== -1);
        t.ok(body.default_members.indexOf(SUB_LOGIN_2) !== -1);
        t.end();
    });
});


test('add existing policy to role', function (t) {
    CLIENT.post('/my/roles/' + ROLE_UUID, {
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


test('add existing policy to role - other', function (t) {
    OTHER.post('/my/roles/' + ROLE_UUID, {
        policies: [POLICY_NAME]
    }, function (err, req, res, body) {
        checkInvalidArgument(t, err, req, res, body);
        t.end();
    });
});


test('add unexisting policy to role', function (t) {
    var fakePolicy = libuuid.create();

    CLIENT.post('/my/roles/' + ROLE_UUID, {
        policies: [POLICY_NAME, fakePolicy]
    }, function (err, req, res, body) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('create another role', function (t) {
    var name = 'a' + libuuid.create().substr(0, 7);

    var entry = {
        name: name,
        members: [SUB_LOGIN, SUB_LOGIN_2],
        policies: [POLICY_NAME]
    };

    CLIENT.post('/my/roles', entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkRole(t, body);

        ROLE_UUID_2 = body.id;

        t.end();
    });
});


test('list roles (OK)', function (t) {
    CLIENT.get('/my/roles', function (err, req, res, body) {
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


test('add role to user resource', function (t) {
    var path = '/my/users/' + SUB_USER.id;
    var role = CLIENT.role.name;

    CLIENT.put(path, {
        'role-tag': [role]
    }, function (err) {
        t.ifError(err);

        CLIENT.get(path, function (err2, req, res, body) {
            t.ifError(err2);
            t.equal(res.headers['role-tag'], role);
            t.end();
        });
    });
});


test('add role to user resource - other', function (t) {
    var path = '/my/users/' + SUB_USER.id;
    var role = CLIENT.role.name;

    OTHER.put(path, {
        'role-tag': [role]
    }, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('add role to resource - other', function (t) {
    var path = '/my/users';
    var role = CLIENT.role.name;

    OTHER.put(path, {
        'role-tag': [role]
    }, function (err, req, res, body) {
        checkInvalidArgument(t, err, req, res, body);
        t.end();
    });
});


test('add role to non-existent user resource', function (t) {
    var badPath = '/my/users/d26f4257-a795-4a7e-a360-e5441b39def0';
    var role = CLIENT.role.name;

    CLIENT.put(badPath, {
        'role-tag': [role]
    }, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('Attempt to create administrator role with policies fails', function (t) {
    var entry = {
        name: ADMIN_ROLE_NAME,
        members: [SUB_LOGIN, SUB_LOGIN_2],
        policies: [POLICY_NAME]
    };

    CLIENT.post('/my/roles', entry, function (err, req, res, body) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.ok(/administrator/i.test(body.message));
        t.end();
    });
});


test('Create administrator role', function (t) {
    var entry = {
        name: ADMIN_ROLE_NAME,
        members: [SUB_LOGIN, SUB_LOGIN_2]
    };

    CLIENT.post('/my/roles', entry, function (err, req, res, body) {
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
        members: [SUB_LOGIN, SUB_LOGIN_2],
        policies: [POLICY_NAME]
    };

    var path = '/my/roles/' + ADMIN_ROLE_ID;

    CLIENT.post(path, entry, function (err, req, res, body) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.ok(/administrator/i.test(body.message));
        t.end();
    });
});


test('Update administrator role with policies fails - other', function (t) {
    var path = '/my/roles/' + ADMIN_ROLE_ID;

    OTHER.post(path, {}, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('delete administrator role - other', function (t) {
    var url = '/my/roles/' + ADMIN_ROLE_ID;

    OTHER.del(url, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});

test('delete administrator role', function (t) {
    var url = '/my/roles/' + ADMIN_ROLE_ID;

    CLIENT.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('ListKeys (empty) OK', function (t) {
    var p = util.format('/my/users/%s/keys', SUB_USER.id);

    CLIENT.get(p, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.notOk(body.length);
        t.end();
    });
});


test('ListKeys (empty) - other', function (t) {
    var p = util.format('/my/users/%s/keys', SUB_USER.id);

    OTHER.get(p, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('CreateKey (missing key)', function (t) {
    var p = util.format('/my/users/%s/keys', SUB_USER.id);

    CLIENT.post(p, {}, function (err) {
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
    var p = util.format('/my/users/%s/keys', SUB_USER.id);

    CLIENT.post(p, key, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkKey(t, body, 'CreateKey body');
        t.equal(body.name, key.name, 'CreateKey name');

        FINGERPRINT = body.fingerprint;

        CLIENT.get(p, function (err2, req2, res2, body2) {
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


test('CreateKey (named) - other', function (t) {
    var key = {
        key: KEY,
        name: 'id_rsa 1'
    };
    var p = util.format('/my/users/%s/keys', SUB_USER.id);

    OTHER.post(p, key, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('Create (named) key with duplicate name', function (t) {
    var key = {
        key: KEY_2,
        name: 'id_rsa 1'
    };

    var p = util.format('/my/users/%s/keys', SUB_USER.id);

    CLIENT.post(p, key, function (err, req, res, body) {
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

    var p = util.format('/my/users/%s/keys', SUB_USER.id);

    CLIENT.post(p, key, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.statusCode, 409);
        t.equal(err.restCode, 'InvalidArgument');
        t.ok(err.message);
        t.end();
    });
});


test('ListKeys OK', function (t) {
    var p = util.format('/my/users/%s/keys', SUB_USER.id);

    CLIENT.get(p, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.equal(body.length, 1);

        checkKey(t, body[0]);
        t.equal(body[0].fingerprint, FINGERPRINT);

        t.end();
    });
});


test('GetKey OK', function (t) {
    var p = util.format('/my/users/%s/keys/', SUB_USER.id);
    var url = p + encodeURIComponent(FINGERPRINT);

    CLIENT.get(url, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        checkKey(t, body);
        t.end();
    });
});


test('GetKey - other', function (t) {
    var p = util.format('/my/users/%s/keys/', SUB_USER.id);
    var url = p + encodeURIComponent(FINGERPRINT);

    OTHER.get(url, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('DeleteKey - other', function (t) {
    var p = util.format('/my/users/%s/keys/', SUB_USER.id);
    var url = p + encodeURIComponent(FINGERPRINT);

    OTHER.del(url, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('DeleteKey OK', function (t) {
    var p = util.format('/my/users/%s/keys/', SUB_USER.id);
    var url = p + encodeURIComponent(FINGERPRINT);

    CLIENT.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('delete role - other', function (t) {
    var url = '/my/roles/' + ROLE_UUID;

    OTHER.del(url, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('delete role', function (t) {
    var url = '/my/roles/' + ROLE_UUID;

    CLIENT.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('delete second role', function (t) {
    var url = '/my/roles/' + ROLE_UUID_2;

    CLIENT.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('delete policy - other', function (t) {
    var url = '/my/policies/' + POLICY_UUID;

    OTHER.del(url, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('delete policy', function (t) {
    var url = '/my/policies/' + POLICY_UUID;

    CLIENT.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('delete user - other', function (t) {
    var url = '/my/users/' + SUB_USER.id;

    OTHER.del(url, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('delete user', function (t) {
    var url = '/my/users/' + SUB_USER.id;

    CLIENT.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('delete another user', function (t) {
    var url = '/my/users/' + SUB_USER_2.id;

    CLIENT.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
