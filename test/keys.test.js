/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var test = require('tap').test;
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var util = require('util');
var common = require('./common');



// --- Globals

var client, server;
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

// --- Helpers

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
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
            server = _server;
        }
        t.end();
    });
});


test('ListKeys (empty) OK', function (t) {
    client.get('/my/keys', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        t.end();
    });
});


test('CreateKey (missing key)', function (t) {
    client.post('/my/keys', {}, function (err) {
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
    client.post('/my/keys', key, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkKey(t, body);
        t.equal(body.name, key.name);
        client.get('/my/keys', function (err2, req2, res2, body2) {
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
    client.post('/my/keys', key, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.statusCode, 409);

        t.equivalent(body, {
            code: 'InvalidArgument',
            message: 'key already exists or is invalid'
        });

        t.end();
    });
});


test('Attempt to create with invalid key', function (t) {
    var key = {
        key: 'asdf',
        name: 'Not so valid'
    };
    client.post('/my/keys', key, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.statusCode, 409);
        t.equal(err.restCode, 'InvalidArgument');
        t.ok(err.message);

        t.equivalent(body, {
            code: 'InvalidArgument',
            message: 'key is invalid'
        });

        t.end();
    });
});


test('ListKeys OK', function (t) {
    client.get('/my/keys', function (err, req, res, body) {
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
    var url = '/my/keys/' + encodeURIComponent('id_rsa 1');
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
    var url = '/my/keys/' + encodeURIComponent('id_rsa 1');
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('DeleteKey 404', function (t) {
    client.del('/my/keys/' + uuid(), function (err) {
        t.ok(err);
        t.equal(err.statusCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);
        t.end();
    });
});


var name;
var fp;
test('CreateKey OK', function (t) {
    client.post('/my/keys', { key: KEY }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        checkKey(t, body);
        name = body.name;
        fp = body.fingerprint;
        t.end();
    });
});


test('Cleanup Key', function (t) {
    var path = '/my/keys/' + encodeURIComponent(name);
    client.del(path, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('GetKey 404', function (t) {
    client.get('/my/keys/' + uuid(), function (err) {
        t.ok(err);
        t.equal(err.statusCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);
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
