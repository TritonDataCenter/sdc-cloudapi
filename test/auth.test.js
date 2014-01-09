// Copyright 2013 Joyent, Inc.  All rights reserved.

var util = require('util');
var fs = require('fs');
var crypto = require('crypto');
var qs = require('querystring');

var test = require('tap').test;
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var restify = require('restify');

var common = require('./common');

// --- Globals

var SIGNATURE = 'Signature keyId="%s",algorithm="%s" %s';
var client, server, account, ssoClient, sigClient;
var KEY_ID;
var fingerprint = '66:ca:1c:09:75:99:35:69:be:91:08:25:03:c0:17:c0';
var privateKey, publicKey;
var SDC_SSO_URI, TOKEN;

// --- Tests

test('setup', function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);
        client = _client;
        privateKey = client.privateKey;
        publicKey = client.publicKey;
        KEY_ID = client.KEY_ID;
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
        }
        server = _server;
        t.end();
    });
});


test('basic auth (accept-version: ~6.5)', function (t) {
    var user = client.testUser;
    var pwd = 'secret123';
    var cli = restify.createJsonClient({
        url: server ? server.url : 'https://127.0.0.1',
        version: '*',
        retryOptions: {
            retry: 0
        },
        log: client.log,
        rejectUnauthorized: false
    });

    cli.basicAuth(user, pwd);

    cli.get({
        path: '/my',
        headers: {
            'accept-version': '~6.5'
        }
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(obj);
        t.equal(obj.login, user);
        cli.close();
        t.end();
    });
});


test('basic auth (x-api-version: ~6.5)', function (t) {
    var user = client.testUser;
    var pwd = 'secret123';
    var cli = restify.createJsonClient({
        url: server ? server.url : 'https://127.0.0.1',
        retryOptions: {
            retry: 0
        },
        log: client.log,
        rejectUnauthorized: false
    });

    cli.basicAuth(user, pwd);

    cli.get({
        path: '/my',
        headers: {
            'x-api-version': '~6.5'
        }
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(obj);
        t.equal(obj.login, user);
        cli.close();
        t.end();
    });
});


test('basic auth (accept-version: ~7.0)', function (t) {
    var user = client.testUser;
    var pwd = 'secret123';
    var cli = restify.createJsonClient({
        url: server ? server.url : 'https://127.0.0.1',
        retryOptions: {
            retry: 0
        },
        log: client.log,
        rejectUnauthorized: false
    });

    cli.basicAuth(user, pwd);

    cli.get({
        path: '/my',
        headers: {
            'accept-version': '~7.0'
        }
    }, function (err, req, res, obj) {
        t.ok(err);
        t.equal(res.statusCode, 401);
        t.ok(/authorization scheme/.test(err.message));
        cli.close();
        t.end();
    });
});


test('admin basic auth (x-api-version: ~6.5)', function (t) {
    var user = 'admin';
    var pwd = 'joypass123';
    var cli = restify.createJsonClient({
        url: server ? server.url : 'https://127.0.0.1',
        retryOptions: {
            retry: 0
        },
        log: client.log,
        rejectUnauthorized: false
    });

    cli.basicAuth(user, pwd);

    cli.get({
        path: '/' + client.testUser,
        headers: {
            'x-api-version': '~6.5'
        }
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(obj);
        t.equal(obj.login, client.testUser);
        cli.close();
        t.end();
    });
});


test('signature auth', function (t) {
    client.get('/my/keys', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(/Signature/.test(req._headers.authorization));
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        t.end();
    });
});

// http-signature 0.10.x test
var httpSignature = require('http-signature');
function requestSigner(req) {
    httpSignature.sign(req, {
        key: privateKey,
        keyId: KEY_ID
    });
}

test('signature auth (http-signature 0.10.x)', function (t) {
    var cli = restify.createJsonClient({
        url: server ? server.url : 'https://127.0.0.1',
        retryOptions: {
            retry: 0
        },
        log: client.log,
        rejectUnauthorized: false,
        signRequest: requestSigner
    });

    cli.get({
        path: '/my/keys',
        headers: {
            'accept-version': '~7.1'
        }
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(/Signature/.test(req._headers.authorization));
        t.ok(obj);
        t.ok(Array.isArray(obj));
        t.ok(obj.length);
        cli.close();
        t.end();
    });
});


function createToken(t, callback) {
    var url = require('url');
    var opts = {
        keyid: encodeURIComponent(KEY_ID),
        nonce: encodeURIComponent('whateveryouwant'),
        now: encodeURIComponent(new Date().toISOString()),
        permissions: encodeURIComponent(JSON.stringify({
            'cloudapi': ['/admin/keys/*', '/admin/keys']
        })),
        returnto: encodeURIComponent(url.format(client.url))
    };

    var query = qs.stringify(opts);
    var urlstring = encodeURIComponent(SDC_SSO_URI + '/login?' + query);
    var signer = crypto.createSign('SHA256');
    signer.update(urlstring);
    var signature = signer.sign(privateKey, 'base64');

    opts.sig = signature;

    ssoClient = restify.createJsonClient({
        url: SDC_SSO_URI,
        version: '*',
        rejectUnauthorized: false,
        agent: false,
        retryOptions: {
            retry: 0
        }
    });

    opts.username = 'admin';
    opts.password = 'joypass123';

    ssoClient.post('/login', opts, function (err, req, res, obj) {
        t.ifError(err, 'Create Token Error');
        t.equal(200, res.statusCode, 'Create Token Status');
        t.ok(obj, 'Create Token Response');
        t.ok(obj.token, 'Create Token TOKEN');
        t.ok(obj.token.data, 'Create Token Data');
        t.ok(obj.token.hash);
        ssoClient.close();
        if (err) {
            return callback(err);
        } else {
            return callback(null, obj.token);
        }
    });
}


// Given the sdcsso zone is optional, do not try to run tests unless we
// already created it and let tests know about:
if (process.env.SDC_SSO_ADMIN_IP) {
    SDC_SSO_URI = 'https://' + process.env.SDC_SSO_ADMIN_IP;
    test('token auth', function (t) {
        createToken(t, function (err, token) {
            t.ifError(err);
            TOKEN = token;

            var now = new Date().toUTCString();
            var alg = 'RSA-SHA256';

            var obj = {
                path: '/admin/keys',
                headers: {
                    Date: now,
                    'x-api-version': '~6.5'
                }
            };

            var signer = crypto.createSign(alg);
            signer.update(now);
            obj.headers.Authorization = util.format(SIGNATURE,
                                            KEY_ID,
                                            alg.toLowerCase(),
                                            signer.sign(privateKey, 'base64'));

            // Magic goes here:
            obj.headers['X-Auth-Token'] = JSON.stringify(TOKEN);



            // The following test is failing.
            // Skipping until can check with John:
            t.test('token auth response', function (t2) {

                sigClient = restify.createJsonClient({
                    url: server ? server.url : 'https://127.0.0.1',
                    version: '*',
                    retryOptions: {
                        retry: 0
                    },
                    log: client.log,
                    rejectUnauthorized: false
                });

                sigClient.get(obj, function (er1, req, res, body) {
                    t2.ifError(er1, 'Token client error');
                    t2.equal(res.statusCode, 200, 'Token client status code');
                    common.checkHeaders(t2, res.headers);
                    t2.ok(/Signature/.test(req._headers.authorization), 'Sig');
                    t2.ok(body, 'Token body');
                    t2.ok(Array.isArray(body), 'Token body is array');
                    // This is admin user, which always has keys
                    t2.ok(body.length, 'Admin has keys');

                    sigClient.close();
                    t2.end();
                });
            });

            t.end();
        });
    });
}


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

    return nuke(function (er2) {
        t.ifError(er2, 'nuke tests error');

        if (!process.env.SDC_SETUP_TESTS) {
            server._clients.ufds.client.removeAllListeners('close');
            server.close(function () {
                t.end();
            });
        } else {
            t.end();
        }
    });
});
