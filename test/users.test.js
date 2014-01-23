// Copyright 2014 Joyent, Inc.  All rights reserved.

var test = require('tap').test;

var libuuid = require('libuuid');
var util = require('util');
var common = require('./common');


// --- Globals

var client, server, account;
var SUB_ID = libuuid.create();
var SUB_LOGIN = 'a' + SUB_ID.substr(0, 7);
var SUB_EMAIL = SUB_LOGIN + '_test@joyent.com';
var SUB_UUID;
var PWD = 'joypass123';

// --- Helpers
function checkUser(t, user) {
    t.ok(user, 'checkUser user OK');
    t.ok(user.id, 'checkUser user.id OK');
    t.ok(user.login, 'checkUser user.login OK');
    t.ok(user.email, 'checkUser user.email OK');
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


test('delete user', function (t) {
    var url = '/my/users/' + SUB_LOGIN;
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
