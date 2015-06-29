/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Functions used in more than one test file + setup/teardown
 * preparation for every test suite.
 */

var assert = require('assert');
var crypto = require('crypto');
var path = require('path');
var Logger = require('bunyan');
var restify = require('restify');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var UFDS = require('sdc-clients').UFDS;
var VMAPI = require('sdc-clients').VMAPI;
var CNAPI = require('sdc-clients').CNAPI;
var NAPI = require('sdc-clients').NAPI;
var IMGAPI = require('sdc-clients').IMGAPI;
var PAPI = require('sdc-clients').PAPI;
var MAHI = require('mahi');
var app = require('../lib').app;
var util = require('util');
var fs = require('fs');
var apertureConfig = require('aperture-config').config;


// --- Globals

var PASSWD = 'secret123';
var DEFAULT_CFG = path.join(__dirname, '..', '/etc/cloudapi.cfg');
var LOG =  new Logger({
    level: process.env.LOG_LEVEL || 'info',
    name: 'cloudapi_unit_test',
    stream: process.stderr,
    serializers: restify.bunyan.serializers
});

var config = {};
try {
    config = JSON.parse(fs.readFileSync(DEFAULT_CFG, 'utf8'));
} catch (e) {}

var SIGNATURE = 'Signature keyId="%s",algorithm="%s" %s';


function requestSigner(req, keyId, privateKey) {
    var d = req.getHeader('Date');

    if (!d) {
        d = new Date().toUTCString();
        req.setHeader('Date', d);
    }

    var alg = 'RSA-SHA256';
    var signer = crypto.createSign(alg);
    signer.update(d);
    req.setHeader('Authorization', util.format(SIGNATURE,
                                    keyId,
                                    alg.toLowerCase(),
                                    signer.sign(privateKey, 'base64')));
}


// Unavoidably, we need to poll some jobs
function _wfapi() {
    return restify.createJsonClient({
        url: process.env.WFAPI_URL || config.wfapi.url || 'http://10.99.99.19',
        version: '*',
        retryOptions: {
            retry: 0
        },
        log: LOG,
        agent: false
    });
}


// We need vmapi client to check jobs on tests, given if we
// just wait for vmachine status change, we'll be just
// hanging forever.
function _vmapi() {
    return new VMAPI({
        url: process.env.VMAPI_URL || config.vmapi.url || 'http://10.99.99.28',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: LOG,
        agent: false
    });
}


function _cnapi() {
    return new CNAPI({
        url: process.env.CNAPI_URL || config.cnapi.url || 'http://10.99.99.22',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: LOG,
        agent: false
    });
}


function _napi() {
    return new NAPI({
        url: process.env.NAPI_URL || config.napi.url || 'http://10.99.99.10',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: LOG,
        agent: false
    });
}


function _imgapi() {
    return new IMGAPI({
        url: process.env.IMGAPI_URL || config.imgapi.url ||
            'http://10.99.99.21',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: LOG,
        agent: false
    });
}


function _papi() {
    return PAPI({
        url: process.env.PAPI_URL || config.papi.url || 'http://10.99.99.30',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: LOG,
        agent: false
    });
}


function _mahi() {
    return MAHI.createClient({
        url: process.env.MAHI_URL || config.mahi.url ||
        'http://10.99.99.34:8080',
        typeTable: apertureConfig.typeTable,
        maxAuthCacheSize: 1,
        maxAuthCacheAgeMs: 5
    });
}


function clientTeardown(cb) {
    var self = this;

    var ufds = self.ufds;
    var id = self.account.uuid;

    self.mahi.close();
    self.close();

    // we ignore errors until the end and try to clean up as much as possible
    ufds.deleteRole(id, self.role.uuid, function (e) {
        ufds.deletePolicy(id, self.policy.uuid, function (e2) {
            ufds.deleteKey(self.testUser, 'id_rsa', function (e3) {
                ufds.deleteKey(self.subuser, 'sub_id_rsa', function (e4) {
                    ufds.deleteUser(self.subuser, function (e5) {
                        ufds.deleteUser(self.testUser, function (e6) {
                            ufds.client.removeAllListeners('close');
                            ufds.client.removeAllListeners('timeout');
                            ufds.removeAllListeners('timeout');

                            ufds.close(function () {
                                return cb(e || e2 || e3 || e4 || e5 || e6);
                            });
                        });
                    });
                });
            });
        });
    });
}


/**
 * Check and log the request ID header
 */
function checkReqId(t, headers) {
    var reqID = headers['x-request-id'];
    t.ok(reqID, 'request ID: ' + reqID);
}


function createTestRole(client, callback) {
    var entry = {
        name: 'test-role',
        uniquemember: [client.subuser.dn],
        memberpolicy: [client.policy.dn],
        uniquememberdefault: [client.subuser.dn],
        account: client.account.uuid
    };

    client.ufds.addRole(client.account.uuid, entry, function (err, role) {
        if (err) {
            return callback(err);
        }

        client.role = role;
        return callback(null, client);
    });
}


function createTestPolicy(client, callback) {
    var entry = {
        name: 'test-policy',
        rule: [
            'CAN getaccount',
            'CAN listusers',
            'CAN createuser',
            'CAN listkeys AND listuserkeys',
            'CAN rebootmachine, createmachine AND getmachine',
            'CAN setroletags'
        ],
        description: 'Policy used by test helper',
        account: client.account.uuid
    };

    client.ufds.addPolicy(client.account.uuid, entry, function (err, policy) {
        if (err) {
            return callback(err);
        }

        client.policy = policy;
        return createTestRole(client, callback);
    });
}


function addSubUserKey(client, callback) {
    var p = __dirname + '/sub_id_rsa';

    return fs.readFile(p + '.pub', 'ascii', function (er1, publicKey) {
        if (er1) {
            return callback(er1);
        }

        client.subPublicKey = publicKey;
        var obj = {
            openssh: publicKey,
            name: 'sub_id_rsa'
        };

        return client.subuser.addKey(obj, function (er2) {
            if (er2) {
                return callback(er2);
            }

            return fs.readFile(p, 'ascii', function (er3, privateKey) {
                if (er3) {
                    return callback(er3);
                }

                client.subPrivateKey = privateKey;
                return createTestPolicy(client, callback);
            });
        });
    });
}


function addUserKey(client, callback) {
    var p = __dirname + '/id_rsa';

    return fs.readFile(p + '.pub', 'ascii', function (er1, publicKey) {
        if (er1) {
            return callback(er1);
        }

        client.publicKey = publicKey;
        var obj = {
            openssh: publicKey,
            name: 'id_rsa'
        };

        return client.account.addKey(obj, function (er2) {
            if (er2) {
                return callback(er2);
            }

            return fs.readFile(p, 'ascii', function (er3, privateKey) {
                if (er3) {
                    return callback(er3);
                }

                client.privateKey = privateKey;
                client.teardown = clientTeardown;

                return addSubUserKey(client, callback);
            });
        });
    });
}


function ufdsConnectCb(client, callback) {
    var ufds = client.ufds;
    var entry = {
        login: client.testUser,
        email: client.testUser,
        userpassword: PASSWD,
        registered_developer: true,
        approved_for_provisioning: true
    };

    return ufds.addUser(entry, function (err, customer) {
        if (err) {
            return callback(err);
        }

        client.account = customer;

        var sub_entry = {
            login: client.testSubUser,
            email: client.testSubUser,
            userpassword: PASSWD,
            account: customer.uuid
        };

        return ufds.addUser(sub_entry, function (err2, sub) {
            if (err2) {
                return callback(err2);
            }

            client.subuser = sub;
            return addUserKey(client, callback);
        });
    });
}


function setupClient(version, serverUrl, user, subLogin, callback) {
    if (typeof (version) === 'function') {
        callback = version;
        version = '*';
    }

    var client = restify.createJsonClient({
        url: serverUrl,
        version: version,
        retryOptions: {
            retry: 0
        },
        log: LOG,
        rejectUnauthorized: false,
        signRequest: function (req) {
            requestSigner(req, client.KEY_ID, client.privateKey);
        }
    });

    // Create clients to all the APIs
    client.wfapi = _wfapi();
    client.vmapi = _vmapi();
    client.cnapi = _cnapi();
    client.napi = _napi();
    client.imgapi = _imgapi();
    client.papi = _papi();
    client.mahi = _mahi();

    client.testUser = user;
    client.KEY_ID = '/' + client.testUser + '/keys/id_rsa';

    client.testSubUser = subLogin;
    client.SUB_ID = '/' + client.testUser + '/users/' + client.testSubUser +
        '/keys/sub_id_rsa';

    var ufds = new UFDS({
        url: process.env.UFDS_URL || config.ufds.url || 'ldaps://10.99.99.18',
        bindDN: config.ufds.bindDN || 'cn=root',
        bindPassword: config.ufds.bindPassword || 'secret',
        log: LOG,
        tlsOptions: {
            rejectUnauthorized: false
        },
        retry: {
            initialDelay: 100
        }
    });

    ufds.once('error', callback);

    ufds.once('connect', function () {
        ufds.removeAllListeners('error');
        ufds.on('error', function (err) {
            LOG.warn(err, 'UFDS: unexpected error occurred');
        });

        ufds.on('close', function () {
            LOG.warn('UFDS: disconnected');
        });

        ufds.on('connect', function () {
            LOG.info('UFDS: reconnected');
        });

        client.ufds = ufds;
        ufdsConnectCb(client, callback);
    });
}


function checkMahiCache(mahiclient, apath, cb) {
    mahiclient._get(apath, function (err, res) {
        if (err) {
            if (err.name === 'AccountDoesNotExistError' ||
                err.name === 'UserDoesNotExistError') {
                return cb(null, false);
            } else {
                return cb(err);
            }
        }

        return cb(null, true, res);
    });
}


function waitForMahiCache(mahiclient, apath, cb) {
    LOG.info('Polling mahi for %s', apath);

    return checkMahiCache(mahiclient, apath, function (err, ready, res) {
        if (err) {
            return cb(err);
        }

        if (!ready) {
            return setTimeout(function () {
                waitForMahiCache(mahiclient, apath, cb);
            }, process.env.POLL_INTERVAL || 1000);
        }

        return cb(null, res);
    });
}


// Creates a temporary user, invokes bodyCb(), destroys the user, then invokes
// cb(). Useful for running tests in bodyCb() with a user that'll be destroyed
// after bodyCb() completes.
function withTemporaryUser(ufdsClient, userOpts, bodyCb, cb) {
    var tmpUser = 'a' + uuid().substr(0, 7) + '.test@joyent.com';

    var entry = {
        login: tmpUser,
        email: tmpUser,
        userpassword: 'BlahBlahBlah12345',
        approved_for_provisioning: true,
        disabled: false
    };

    // add or override default user values with anything in userOpts
    Object.keys(userOpts).forEach(function (key) {
        entry[key] = userOpts[key];
    });

    ufdsClient.addUser(entry, createTmpUser);

    function createTmpUser(err, tmpAccount, callback) {
        if (err) {
            return invokeBodyCb(err);
        }

        tmpAccount.passwd = entry.userpassword; // sometimes bodyCb needs this

        var keyPath = __dirname + '/id_rsa.pub';
        return fs.readFile(keyPath, 'ascii', function readKey(err2, data) {
            if (err2) {
                return invokeBodyCb(err2);
            }

            return ufdsClient.addKey(tmpAccount, {
                openssh: data,
                name: 'id_rsa'
            }, function (err3, tmpKey) {
                invokeBodyCb(err3, tmpAccount, tmpKey);
            });
        });
    }

    function invokeBodyCb(err, tmpAccount, tmpKey) {
        bodyCb(err, tmpAccount, function () {
            destroyTmpUser(null, tmpAccount, tmpKey);
        });
    }

    function destroyTmpUser(err, tmpAccount, tmpKey) {
        // ignore errors, and hope things work out
        ufdsClient.deleteKey(tmpAccount, tmpKey, function (err2) {
            ufdsClient.deleteUser(tmpAccount, cb);
        });
    }
}


function setup(version, cb) {
    if (typeof (version) === 'function') {
        cb = version;
        version = '*';
    }
    assert.ok(cb);

    var user = 'a' + uuid().substr(0, 7) + '.test@joyent.com';
    var subLogin = 'a' + uuid().substr(0, 7) + '.sub.test@joyent.com';

    config.log = LOG;

    if (process.env.SDC_SETUP_TESTS) {
        // Already have a running server instance, no need to boot another one:
        return setupClient(version, 'https://127.0.0.1', user, subLogin, cb);
    }

    config.test = true;

    return app.createServer(config, function (err, server) {
        if (err) {
            throw err;
        }

        server.start(function () {
            LOG.info('CloudAPI listening at %s', server.url);

            setupClient(version, server.url, user, subLogin,
                        function (err2, client) {
                cb(err, client, server);
            });
        });
    });
}


function checkHeaders(t, headers) {
    assert.ok(t);
    t.ok(headers, 'headers ok');

    if (!headers) {
        return;
    }

    t.ok(headers['access-control-allow-origin'], 'headers allow-origin');
    t.ok(headers['access-control-allow-methods'], 'headers allow-methods');
    t.ok(headers.date, 'headers date');
    t.ok(headers['x-request-id'], 'headers x-request-id');
    t.ok(headers['x-response-time'] >= 0, 'headers response time');
    t.ok(headers.server, 'headers server');
    t.equal(headers.connection, 'Keep-Alive', 'headers connection');
    t.ok(headers['x-api-version'], 'headers x-api-version OK');
}


function checkVersionHeader(t, version, headers) {
    assert.ok(t);
    assert.ok(version);

    var msg = util.format('headers x-api-version %s', version);
    t.equal(headers['x-api-version'], version, msg);
}


// --- Library

module.exports = {
    setup: setup,
    checkHeaders: checkHeaders,
    checkReqId: checkReqId,
    checkVersionHeader: checkVersionHeader,
    checkMahiCache: checkMahiCache,
    waitForMahiCache: waitForMahiCache,
    withTemporaryUser: withTemporaryUser,

    getCfg: function () {
        return config;
    }
};
