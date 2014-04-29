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
var KEY_ID, SUB_KEY_ID;
var fingerprint = '66:ca:1c:09:75:99:35:69:be:91:08:25:03:c0:17:c0';
var sub_fp = 'f4:1a:34:3c:2c:81:69:5b:83:20:72:e2:b4:57:3e:71';
var privateKey, publicKey;
var subPrivateKey, subPublicKey;
var SDC_SSO_URI, TOKEN;


// Helpers
function checkMahiCache(mahi, path, cb) {
    mahi._get(path, function (err, res) {
        if (err) {
            if (err.name === 'AccountDoesNotExistError' ||
                err.name === 'UserDoesNotExistError') {
                return cb(null, false);
            } else {
                return cb(err);
            }
        }
        return cb(null, true);

    });
}

function waitForMahiCache(mahi, path, cb) {
    client.log.info('Polling mahi for %s', path);
    return checkMahiCache(mahi, path, function (err, ready) {
        if (err) {
            return cb(err);
        }
        if (!ready) {
            return setTimeout(function () {
                waitForMahiCache(mahi, path, cb);
            }, (process.env.POLL_INTERVAL || 1000));
        }
        return cb(null);
    });
}

// --- Tests

test('setup', function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);
        client = _client;
        privateKey = client.privateKey;
        publicKey = client.publicKey;
        subPublicKey = client.subPublicKey;
        subPrivateKey = client.subPrivateKey;
        account = client.account.login;
        KEY_ID = client.KEY_ID;
        SUB_KEY_ID = client.SUB_ID;
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


// Account sub-users will use only http-signature >= 0.10.x, given this
// feature has been added after moving from 0.9.
// Also, request version will always be >= 7.2 here.
// PLEASE, NOTE SUB-USER REQUESTS USING "/my" WILL BE USELESS, NEED TO PROVIDE
// MAIN ACCOUNT "login" COMPLETE "/:account".

// Before we can test authorize, we need to add couple roles/policies:
var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var POLICY_FMT = 'policy-uuid=%s, ' + USER_FMT;
var ROLE_FMT = 'role-uuid=%s, ' + USER_FMT;
var A_POLICY_UUID, A_POLICY_DN, A_POLICY_NAME;
var A_ROLE_UUID, A_ROLE_DN, A_ROLE_NAME;


test('create policy', function (t) {
    var policy_uuid = libuuid.create();
    var name = 'a' + policy_uuid.substr(0, 7);

    var entry = {
        name: name,
        rules: [
            '* CAN get * IF route::string = getaccount',
            '* CAN get AND head * IF route::string = listusers',
            '* CAN post * IF route::string = createuser',
            'Foobar CAN get * IF route::string = listkeys',
            util.format('%s CAN get * IF route::string = listuserkeys',
                client.testSubUser)
        ],
        description: 'This is the account/users policy'
    };

    client.post('/my/policies', entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        A_POLICY_UUID = body.id;
        A_POLICY_NAME = body.name;
        A_POLICY_DN = util.format(POLICY_FMT, A_POLICY_UUID, account.uuid);
        t.end();
    });
});


test('create role', function (t) {
    var role_uuid = libuuid.create();
    var name = 'a' + role_uuid.substr(0, 7);

    var entry = {
        name: name,
        members: client.testSubUser,
        policies: [A_POLICY_NAME],
        default_members: client.testSubUser
    };

    client.post('/my/roles', entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        A_ROLE_UUID = body.id;
        A_ROLE_NAME = body.name;
        A_ROLE_DN = util.format(ROLE_FMT, A_ROLE_UUID, account.uuid);
        t.end();
    });
});


test('tag resource with role', function (t) {
    client.put('/my/users', {
        'role-tag': [A_ROLE_NAME]
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.name, 'resource role name');
        t.ok(body['role-tag'], 'resource role tag');
        t.ok(body['role-tag'].length, 'resource role tag ary');
        t.end();
    });
});


test('get resource role-tag', function (t) {
    var p = '/my/users?role-tag=true';
    client.get(p, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.name, 'resource role name');
        t.ok(body['role-tag'], 'resource role tag');
        t.ok(body['role-tag'].length, 'resource role tag ary');
        t.equal(body['role-tag'][0], A_ROLE_NAME, 'resource role');
        t.end();
    });
});


test('sub-user signature auth (0.10)', { timeout: 'Infinity' }, function (t) {
    function subRequestSigner(req) {
        httpSignature.sign(req, {
            key: subPrivateKey,
            keyId: SUB_KEY_ID
        });
    }

    var mPath = util.format('/user/%s/%s', account, client.testSubUser);
    waitForMahiCache(client.mahi, mPath, function (er) {
        t.ifError(er, 'wait for mahi cache error');
        var cli = restify.createJsonClient({
            url: server ? server.url : 'https://127.0.0.1',
            retryOptions: {
                retry: 0
            },
            log: client.log,
            rejectUnauthorized: false,
            signRequest: subRequestSigner
        });

        // TODO: Any user should be able to read account, write account
        // should be the forbidden piece:
        t.test('sub-user get account', { timeout: 'Infinity' }, function (t2) {
            cli.get({
                path: '/' + account,
                headers: {
                    'accept-version': '~7.2'
                }
            }, function (err, req, res, obj) {
                t2.ok(err, 'sub-user get account error');
                t2.equal(res.statusCode, 403, 'sub-user auth statusCode');
                t2.end();
            });
        });

        t.test('sub-user get users', { timeout: 'Infinity' }, function (t1) {
            cli.get({
                path: '/' + account + '/users',
                headers: {
                    'accept-version': '~7.2'
                }
            }, function (err, req, res, obj) {
                t1.ifError(err, 'sub-user get users error');
                t1.equal(res.statusCode, 200, 'sub-user auth statusCode');
                t1.end();
            });
        });

        // TODO: Any user should be able to get thyself
        t.test('sub-user get thyself', { timeout: 'Infinity' }, function (t3) {
            cli.get({
                path: util.format('/%s/users/%s', account, client.testSubUser),
                headers: {
                    'accept-version': '~7.2'
                }
            }, function (err, req, res, obj) {
                t3.ok(err, 'sub-user get thyself error');
                t3.equal(res.statusCode, 403, 'sub-user auth statusCode');
                cli.close();
                t3.end();
            });
        });

        t.end();
    });
});


// We also have to cleanup all the roles/policies:

test('delete role', function (t) {
    var url = '/my/roles/' + A_ROLE_UUID;
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('delete policy', function (t) {
    var url = '/my/policies/' + A_POLICY_UUID;
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
