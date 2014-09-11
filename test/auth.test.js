/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

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

var common = require('./common'),
    checkMahiCache = common.checkMahiCache,
    waitForMahiCache = common.waitForMahiCache;

var vasync = require('vasync');

// --- Globals

var SIGNATURE = 'Signature keyId="%s",algorithm="%s" %s';
var client, server, account, ssoClient, sigClient;
var KEY_ID, SUB_KEY_ID;
var fingerprint = '66:ca:1c:09:75:99:35:69:be:91:08:25:03:c0:17:c0';
var sub_fp = 'f4:1a:34:3c:2c:81:69:5b:83:20:72:e2:b4:57:3e:71';
var privateKey, publicKey;
var subPrivateKey, subPublicKey;
var SDC_SSO_URI, TOKEN;

var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var POLICY_FMT = 'policy-uuid=%s, ' + USER_FMT;
var ROLE_FMT = 'role-uuid=%s, ' + USER_FMT;
var A_POLICY_NAME;
var A_ROLE_NAME;

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
        A_ROLE_NAME = client.role.name;
        A_POLICY_NAME = client.policy.name;
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
            server = _server;
        }
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
test('tag resource collection with role', function (t) {
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


test('tag resource collection with non-existent role', function (t) {
    client.put('/my/users', {
        'role-tag': ['asdasdasdasd']
    }, function (err, req, res, body) {
        t.equivalent(err, {
            message: 'Role(s) asdasdasdasd not found',
            statusCode: 409,
            restCode: 'InvalidArgument',
            name: 'InvalidArgumentError',
            body: {
                code: 'InvalidArgument',
                message: 'Role(s) asdasdasdasd not found'
            }
        });
        t.end();
    });
});


test('get resource collection role-tag', function (t) {
    var p = '/my/users';
    client.get({
        path: p
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body[0].login, 'resource is a user');
        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], A_ROLE_NAME, 'resource role-tag');
        t.end();
    });
});


test('tag individual resource with role', function (t) {
    client.put('/my/users/' + client.testSubUser, {
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


test('tag individual resource with non-existent role', function (t) {
    client.put('/my/users/' + client.testSubUser, {
        'role-tag': ['asdasdasdasd']
    }, function (err, req, res, body) {
        t.equivalent(err, {
            message: 'Role(s) asdasdasdasd not found',
            statusCode: 409,
            restCode: 'InvalidArgument',
            name: 'InvalidArgumentError',
            body: {
                code: 'InvalidArgument',
                message: 'Role(s) asdasdasdasd not found'
            }
        });
        t.end();
    });
});


test('get individual resource role-tag', function (t) {
    var p = '/my/users/' + client.testSubUser;
    client.get({
        path: p
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.login, 'resource is a user');
        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], A_ROLE_NAME, 'resource role-tag');
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
    // We need to check that mahi-replicator has caught up with our latest
    // operation, which is adding the test-role to the test sub user:
    function waitMahiReplicator(cb) {
        waitForMahiCache(client.mahi, mPath, function (er, cache) {
            if (er) {
                client.log.error({err: er}, 'Error fetching mahi resource');
                t.fail('Error fetching mahi resource');
                t.end();
            } else {
                if (!cache.roles || Object.keys(cache.roles).length === 0 ||
                    Object.keys(cache.roles).indexOf(client.role.uuid) === -1) {
                    setTimeout(function () {
                        waitMahiReplicator(cb);
                    }, 1000);
                } else {
                    cb();
                }
            }
        });
    }


    waitMahiReplicator(function () {
        var cli = restify.createJsonClient({
            url: server ? server.url : 'https://127.0.0.1',
            retryOptions: {
                retry: 0
            },
            log: client.log,
            rejectUnauthorized: false,
            signRequest: subRequestSigner
        });

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

        // Even when we've added the role-tag, the policies into the role don't
        // include a rule with route::string = 'getuser', therefore the 403:
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

        t.test('sub-user with as-role', { timeout: 'Infinity' }, function (t4) {
            var accountUuid = client.account.uuid;
            var roleUuid    = client.role.uuid;
            var ufds        = client.ufds;

            var oldDefaultMembers;
            function getRole(_, cb) {
                ufds.getRole(accountUuid, roleUuid, function (err, role) {
                    if (err) {
                        return cb(err);
                    }

                    oldDefaultMembers = role.uniquememberdefault;

                    return cb();
                });
            }

            function removeDefaultMembers(_, cb) {
                var changes = { uniquememberdefault: null };
                ufds.modifyRole(accountUuid, roleUuid, changes, cb);
            }

            function checkCannotGet(_, cb) {
                cli.get({
                    path: '/' + account + '/users',
                    headers: {
                        'accept-version': '~7.2'
                    }
                }, function (err, req, res, obj) {
                    cli.close();

                    if (err && err.statusCode !== 403) {
                        return cb(err);
                    }

                    return cb();
                });
            }

            function checkCanGetWithRole(_, cb) {
                cli.get({
                    path: '/' + account + '/users?as-role=' + client.role.name,
                    headers: {
                        'accept-version': '~7.2'
                    }
                }, function (err, req, res, obj) {
                    if (err) {
                        return cb(err);
                    }

                    cli.close();


                    if (res.statusCode !== 200) {
                        var msg = 'checkCanGetWithRole did not return 200';
                        return cb(new Error(msg));
                    }

                    return cb();
                });
            }

            function revertDefaultMembers(_, cb) {
                var changes = { uniquememberdefault: oldDefaultMembers };
                ufds.modifyRole(accountUuid, roleUuid, changes, cb);
            }

            vasync.pipeline({
                funcs: [
                    getRole, removeDefaultMembers, checkCannotGet,
                    checkCanGetWithRole, revertDefaultMembers
                ]
            }, function (err) {
                t4.ifError(err, 'sub-user with as-role error');
                t4.end();
            });
        });

        t.end();
    });
});


// Adding role-tag at creation time:
var B_ROLE_UUID, B_ROLE_DN, B_ROLE_NAME;

test('create role with role-tag', function (t) {
    var role_uuid = libuuid.create();
    var name = 'a' + role_uuid.substr(0, 7);

    var entry = {
        name: name,
        members: client.testSubUser,
        policies: [A_POLICY_NAME],
        default_members: client.testSubUser
    };

    client.post({
        path: '/my/roles',
        headers: {
            'role-tag': [A_ROLE_NAME]
        }
    }, entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        B_ROLE_UUID = body.id;
        B_ROLE_NAME = body.name;
        B_ROLE_DN = util.format(ROLE_FMT, B_ROLE_UUID, account.uuid);
        t.end();
    });
});


test('update role with role-tag', function (t) {
    var p = '/my/roles/' + B_ROLE_UUID;
    B_ROLE_NAME = 'Something-different';
    client.post({
        path: p,
        headers: {
            'role-tag': [A_ROLE_NAME]
        }
    }, {
        name: B_ROLE_NAME
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.end();
    });
});


test('delete role with role-tag', function (t) {
    var url = '/my/roles/' + B_ROLE_UUID;
    client.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('tag /:account with role', function (t) {
    client.put('/' + account, {
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


test('get /:account role-tag', function (t) {
    var p = '/' + account;
    client.get({
        path: p
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.login, 'resource is a user');
        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], A_ROLE_NAME, 'resource role-tag');
        t.end();
    });
});





test('cleanup sdcAccountResources', function (t) {
    var id = client.account.uuid;
    client.ufds.listResources(id, function (err, resources) {
        t.ifError(err);
        vasync.forEachPipeline({
            inputs: resources,
            func: function (resource, _cb) {
                client.ufds.deleteResource(id, resource.uuid, function (er2) {
                    return _cb();
                });
            }
        }, function (er3, results) {
            t.ifError(er3);
            t.end();
        });
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
