/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var util = require('util');
var crypto = require('crypto');
var Keyapi = require('keyapi');
var test = require('tape').test;
var restify = require('restify');
var vasync = require('vasync');

var common = require('./common'),
    waitForMahiCache = common.waitForMahiCache;



// --- Globals


var SIGNATURE_FMT = 'Signature keyId="%s",algorithm="%s" %s';
var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var POLICY_FMT = 'policy-uuid=%s, ' + USER_FMT;
var ROLE_FMT = 'role-uuid=%s, ' + USER_FMT;

var CLIENTS;
var CLIENT;
var SUB_CLIENT;
var SERVER;

var POLICY_NAME;
var ROLE_NAME;


// --- Tests


test('setup', function (t) {
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        SERVER  = server;

        CLIENT      = clients.user;
        SUB_CLIENT  = clients.subuser;

        ROLE_NAME   = CLIENT.role.name;
        POLICY_NAME = CLIENT.policy.name;

        t.end();
    });
});


test('basic auth (accept-version: ~6.5)', function (t) {
    var user = CLIENT.login;
    var pwd  = CLIENT.passwd;

    var cli = restify.createJsonClient({
        url: SERVER.url,
        version: '*',
        retryOptions: {
            retry: 0
        },
        log: CLIENT.log,
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
    var user = CLIENT.login;
    var pwd  = CLIENT.passwd;

    var cli = restify.createJsonClient({
        url: SERVER.url,
        retryOptions: {
            retry: 0
        },
        log: CLIENT.log,
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
    var user = CLIENT.login;
    var pwd  = CLIENT.passwd;

    var cli = restify.createJsonClient({
        url: SERVER.url,
        retryOptions: {
            retry: 0
        },
        log: CLIENT.log,
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
        url: SERVER.url,
        retryOptions: {
            retry: 0
        },
        log: CLIENT.log,
        rejectUnauthorized: false
    });

    cli.basicAuth(user, pwd);

    cli.get({
        path: '/' + CLIENT.login,
        headers: {
            'x-api-version': '~6.5'
        }
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(obj);
        t.equal(obj.login, CLIENT.login);

        cli.close();
        t.end();
    });
});


test('signature auth', function (t) {
    CLIENT.get('/my/keys', function (err, req, res, body) {
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
        key: CLIENT.privateKey,
        keyId: CLIENT.keyId
    });
}

test('signature auth (http-signature 0.10.x)', function (t) {
    var cli = restify.createJsonClient({
        url: SERVER.url,
        retryOptions: {
            retry: 0
        },
        log: CLIENT.log,
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



test('token auth', function (t) {
    var config = common.getCfg();
    var keyapi = new Keyapi({ log: config.log, ufds: config.ufds });

    var now = new Date().toUTCString();
    var alg = 'RSA-SHA256';

    var signer = crypto.createSign(alg);
    signer.update(now);
    var sig = signer.sign(CLIENT.privateKey, 'base64');

    var authorization = util.format(SIGNATURE_FMT, CLIENT.keyId,
                                    alg.toLowerCase(), sig);

    var sigClient = restify.createJsonClient({
        url: SERVER.url,
        version: '*',
        retryOptions: {
            retry: 0
        },
        log: CLIENT.log,
        rejectUnauthorized: false
    });

    function generateRequest(token) {
        return {
            path: '/admin/keys',
            headers: {
                // do not change case of 'date'; some versions of restify won't
                // override the date then, and sporadic failures occur
                date: now,
                'x-auth-token': JSON.stringify(token),
                'x-api-version': '~6.5',
                authorization: authorization
            }
        };
    }

    function callWithBadDetails(_t, details) {
        keyapi.token(details, function (err, token) {
            _t.ifError(err);

            var obj = generateRequest(token);

            sigClient.get(obj, function (err2, req, res, body) {
                _t.ok(err2);
                _t.deepEqual(body, {
                    code: 'InvalidCredentials',
                    message: 'The token provided is not authorized for this ' +
                            'application'
                });

                _t.end();
            });
        });
    }

    t.test('token with empty details', function (t2) {
        callWithBadDetails(t2, {});
    });

    t.test('token with wrong permission path', function (t2) {
        var tokenDetails = {
            account: CLIENT.account,
            devkeyId: CLIENT.keyId,
            permissions: { cloudapi: ['/admin/other_things'] },
            expires: new Date(+new Date() + 1000).toISOString()
        };

        callWithBadDetails(t2, tokenDetails);
    });

    t.test('token with wrong expires', function (t2) {
        var tokenDetails = {
            account: CLIENT.account,
            devkeyId: CLIENT.keyId,
            permissions: { cloudapi: ['/admin/keys'] },
            expires: new Date(+new Date() - 1000).toISOString()
        };

        callWithBadDetails(t2, tokenDetails);
    });

    t.test('token with wrong devkeyId', function (t2) {
        var tokenDetails = {
            account: CLIENT.account,
            devkeyId: '/verybadkey@joyent.com/keys/id_rsa',
            permissions: { cloudapi: ['/admin/keys'] },
            expires: new Date(+new Date() + 1000).toISOString()
        };

        callWithBadDetails(t2, tokenDetails);
    });

    t.test('token auth response', function (t2) {
        var tokenDetails = {
            account: CLIENT.account,
            devkeyId: CLIENT.keyId,
            permissions: { cloudapi: ['/admin/keys'] },
            expires: new Date(+new Date() + 1000).toISOString()
        };

        keyapi.token(tokenDetails, function (err, token) {
            t2.ifError(err);

            var obj = generateRequest(token);

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
    });

    t.end();
});


// We need to create a new user here, because the ufds entries cached
// inside cloudapi conflict with simple updates of the existing user. That
// implies skipping using the existing http client.
test('auth of disabled account', function (t) {
    function attemptGet(err, tmpAccount, cb) {
        t.ifError(err);

        var httpClient = restify.createJsonClient({
            url: CLIENT.url.href, // grab from old client
            retryOptions: { retry: 0 },
            log: CLIENT.log,
            rejectUnauthorized: false
        });

        // cheating a bit by using the old auth method to make things easier
        httpClient.basicAuth(tmpAccount.login, tmpAccount.passwd);

        httpClient.get({
            path: '/my',
            headers: {
                'accept-version': '~6.5'
            }
        }, function (err2, req, res, body) {
            t.ok(err2);

            t.deepEqual(body, {
                code: 'NotAuthorized',
                message: 'Account or user is disabled'
            });

            httpClient.close();

            cb();
        });
    }

    function done() {
        t.end();
    }

    var opts = {
        disabled: true
    };

    common.withTemporaryUser(CLIENT.ufds, opts, attemptGet, done);
});


// Account sub-users will use only http-signature >= 0.10.x, given this
// feature has been added after moving from 0.9.
// Also, request version will always be >= 7.2 here.
test('tag resource collection with role', function (t) {
    CLIENT.put('/my/users', {
        'role-tag': [ROLE_NAME]
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
    CLIENT.put('/my/users', {
        'role-tag': ['asdasdasdasd']
    }, function (err, req, res, body) {
        t.deepEqual(err, {
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
    CLIENT.get({
        path: p
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body[0].login, 'resource is a user');
        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], ROLE_NAME, 'resource role-tag');
        t.end();
    });
});


test('tag individual resource with role', function (t) {
    CLIENT.put('/my/users/' + SUB_CLIENT.login, {
        'role-tag': [ROLE_NAME]
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
    CLIENT.put('/my/users/' + SUB_CLIENT.login, {
        'role-tag': ['asdasdasdasd']
    }, function (err, req, res, body) {
        t.deepEqual(err, {
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
    var p = '/my/users/' + SUB_CLIENT.login;
    CLIENT.get({
        path: p
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.login, 'resource is a user');
        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], ROLE_NAME, 'resource role-tag');
        t.end();
    });
});


test('sub-user signature auth (0.10)', function (t) {
    function subRequestSigner(req) {
        httpSignature.sign(req, {
            key: SUB_CLIENT.privateKey,
            keyId: SUB_CLIENT.keyId
        });
    }

    var mPath = util.format('/user/%s/%s', CLIENT.login, SUB_CLIENT.login);
    // We need to check that mahi-replicator has caught up with our latest
    // operation, which is adding the test-role to the test sub user:
    function waitMahiReplicator(cb) {
        waitForMahiCache(CLIENT.mahi, mPath, function (er, cache) {
            if (er) {
                CLIENT.log.error({err: er}, 'Error fetching mahi resource');
                t.fail('Error fetching mahi resource');
                t.end();
            } else {
                if (!cache.roles || Object.keys(cache.roles).length === 0 ||
                    Object.keys(cache.roles).indexOf(CLIENT.role.uuid) === -1) {
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
            url: SERVER.url,
            retryOptions: {
                retry: 0
            },
            log: CLIENT.log,
            rejectUnauthorized: false,
            signRequest: subRequestSigner
        });

        t.test('sub-user get account', function (t2) {
            cli.get({
                path: '/' + CLIENT.login,
                headers: {
                    'accept-version': '~7.2'
                }
            }, function (err, req, res, obj) {
                t2.ok(err, 'sub-user get account error');
                t2.equal(res.statusCode, 403, 'sub-user auth statusCode');
                t2.end();
            });
        });

        t.test('sub-user get users', function (t1) {
            cli.get({
                path: '/' + CLIENT.login + '/users',
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
        t.test('sub-user get thyself', function (t3) {
            cli.get({
                path: util.format('/%s/users/%s', CLIENT.login,
                                    SUB_CLIENT.login),
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

        t.test('sub-user with as-role', function (t4) {
            var accountUuid = CLIENT.account.uuid;
            var roleUuid    = CLIENT.role.uuid;
            var ufds        = CLIENT.ufds;

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
                    path: '/' + CLIENT.login + '/users',
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
                    path: '/' + CLIENT.login + '/users?as-role=' +
                            CLIENT.role.name,
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
    var roleUuid = common.uuid();
    var name = 'a' + roleUuid.substr(0, 7);

    var entry = {
        name: name,
        members: SUB_CLIENT.login,
        policies: [POLICY_NAME],
        default_members: SUB_CLIENT.login
    };

    CLIENT.post({
        path: '/my/roles',
        headers: {
            'role-tag': [ROLE_NAME]
        }
    }, entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        B_ROLE_UUID = body.id;
        B_ROLE_NAME = body.name;
        B_ROLE_DN = util.format(ROLE_FMT, B_ROLE_UUID, CLIENT.account.uuid);
        t.end();
    });
});


test('update role with role-tag', function (t) {
    var p = '/my/roles/' + B_ROLE_UUID;
    B_ROLE_NAME = 'Something-different';
    CLIENT.post({
        path: p,
        headers: {
            'role-tag': [ROLE_NAME]
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
    CLIENT.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('tag /:account with role', function (t) {
    CLIENT.put('/' + CLIENT.login, {
        'role-tag': [ROLE_NAME]
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
    var p = '/' + CLIENT.login;
    CLIENT.get({
        path: p
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.login, 'resource is a user');
        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], ROLE_NAME, 'resource role-tag');
        t.end();
    });
});


test('cleanup sdcAccountResources', function (t) {
    var id = CLIENT.account.uuid;
    CLIENT.ufds.listResources(id, function (err, resources) {
        t.ifError(err);
        vasync.forEachPipeline({
            inputs: resources,
            func: function (resource, _cb) {
                CLIENT.ufds.deleteResource(id, resource.uuid, function (er2) {
                    return _cb();
                });
            }
        }, function (er3, results) {
            t.ifError(er3);
            t.end();
        });
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function () {
        t.end();
    });
});
