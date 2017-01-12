/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var test = require('tape').test;
var util = require('util');
var common = require('./common');


// --- Globals


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

var CLIENTS;
var CLIENT;
var OTHER;
var SERVER;

var KEY_NAME;
var FINGERPRINT;


// --- Helpers


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
        OTHER   = clients.other;
        SERVER  = server;

        t.end();
    });
});


test('ListKeys (empty) OK', function (t) {
    CLIENT.get('/my/keys', function (err, req, res, body) {
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
    CLIENT.post('/my/keys', {}, function (err) {
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

    CLIENT.post('/my/keys', key, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkKey(t, body);
        t.equal(body.name, key.name);

        CLIENT.get('/my/keys', function (err2, req2, res2, body2) {
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
        key: KEY_2,
        name: 'id_rsa 1'
    };

    CLIENT.post('/my/keys', key, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.statusCode, 409);

        t.deepEqual(body, {
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

    CLIENT.post('/my/keys', key, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.statusCode, 409);
        t.equal(err.restCode, 'InvalidArgument');
        t.ok(err.message);

        t.deepEqual(body, {
            code: 'InvalidArgument',
            message: 'key is invalid'
        });

        t.end();
    });
});


test('ListKeys OK', function (t) {
    CLIENT.get('/my/keys', function (err, req, res, body) {
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


// OTHER should only be able to see the key it was created with by setup
test('ListKeys OK - other', function (t) {
    OTHER.get('/my/keys', function (err, req, res, body) {
        t.ifError(err);
        t.equal(body.length, 1);
        t.equal(body[0].name, 'id_rsa');
        t.equal(body[0].fingerprint, '33:06:df:67:4e:fc:b5:e3:da:3b:df:97:' +
                '83:8e:fc:9a');
        t.end();
    });
});


test('GetKey OK', function (t) {
    var url = '/my/keys/' + encodeURIComponent('id_rsa 1');

    CLIENT.get(url, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        checkKey(t, body);
        t.end();
    });
});


test('GetKey OK - other', function (t) {
    var url = '/my/keys/' + encodeURIComponent('id_rsa 1');

    OTHER.get(url, function (err, req, res, body) {
        t.ok(err);
        t.ok(body);

        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);

        t.equal(body.code, 'ResourceNotFound');
        t.ok(body.message);

        t.equal(res.statusCode, 404);

        t.end();
    });
});


test('DeleteKey OK - other', function (t) {
    var url = '/my/keys/' + encodeURIComponent('id_rsa 1');

    OTHER.del(url, function (err, req, res) {
        t.ok(err);

        t.deepEqual(err, {
            body: {
                code: 'ResourceNotFound',
                message: 'id_rsa 1 does not exist'
            },
            jse_info: {},
            jse_shortmsg: '',
            message: 'id_rsa 1 does not exist',
            name: 'ResourceNotFoundError',
            restCode: 'ResourceNotFound',
            statusCode: 404
        });

        t.end();
    });
});


test('DeleteKey OK', function (t) {
    var url = '/my/keys/' + encodeURIComponent('id_rsa 1');

    CLIENT.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('DeleteKey 404', function (t) {
    CLIENT.del('/my/keys/' + common.uuid(), function (err) {
        t.ok(err);
        t.equal(err.statusCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);
        t.end();
    });
});


test('CreateKey OK', function (t) {
    CLIENT.post('/my/keys', { key: KEY }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        checkKey(t, body);

        KEY_NAME = body.name;
        FINGERPRINT = body.fingerprint;

        t.end();
    });
});


test('Cleanup Key', function (t) {
    var path = '/my/keys/' + encodeURIComponent(KEY_NAME);

    CLIENT.del(path, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('GetKey 404', function (t) {
    CLIENT.get('/my/keys/' + common.uuid(), function (err) {
        t.ok(err);
        t.equal(err.statusCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);
        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
