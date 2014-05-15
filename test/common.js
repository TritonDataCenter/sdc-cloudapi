/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
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
var app = require('../lib').app;
var util = require('util');
var fs = require('fs');
var mahi = require('mahi');
var apertureConfig = {
    typeTable: {
        ip: 'ip',
        requestip: 'ip',
        tag: 'string'
    }
};
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


var SDC_SETUP_TESTS = process.env.SDC_SETUP_TESTS || false;

var user, ufds, client, server, account, sub_login, subuser, policy, role;

var SIGNATURE = 'Signature keyId="%s",algorithm="%s" %s';
var KEY_ID;
var fingerprint = '66:ca:1c:09:75:99:35:69:be:91:08:25:03:c0:17:c0';
var sub_fp = 'f4:1a:34:3c:2c:81:69:5b:83:20:72:e2:b4:57:3e:71';
var privateKey, publicKey;


function requestSigner(req) {
    var d = req.getHeader('Date');

    if (!d) {
        d = new Date().toUTCString();
        req.setHeader('Date', d);
    }

    var alg = 'RSA-SHA256';
    var signer = crypto.createSign(alg);
    signer.update(d);
    req.setHeader('Authorization', util.format(SIGNATURE,
                                    KEY_ID,
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
        log: client.log,
        agent: false
    });
}

// Given DAPI will never pick Headnode as a server to provision to, we need
// to explicitly tell we want it:
function _cnapi() {
    return new CNAPI({
        url: process.env.CNAPI_URL || config.cnapi.url || 'http://10.99.99.22',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: client.log,
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
        log: client.log,
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
        log: client.log,
        agent: false
    });
}

function _papi() {
    return PAPI({
        url: process.env.PAPI_URL || config.papi.url ||
            'http://10.99.99.30',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: client.log,
        agent: false
    });
}


function _mahi() {
    return mahi.createClient({
        url: process.env.MAHI_URL || config.mahi.url ||
        'http://10.99.99.34:8080',
        typeTable: apertureConfig.typeTable,
        maxAuthCacheSize: 1,
        maxAuthCacheAgeMs: 5
    });
}


function clientTeardown(cb) {
    client.mahi.close();
    client.close();
    var id = client.account.uuid;
    client.ufds.deleteRole(id, client.role.uuid, function (er6) {
        client.ufds.deletePolicy(id, client.policy.uuid, function (er7) {
            client.ufds.deleteKey(client.testUser, 'id_rsa', function (er4) {
                client.ufds.deleteKey(client.subuser, 'sub_id_rsa',
                    function (er5) {
                    client.ufds.deleteUser(client.subuser, function (err3) {
                        client.ufds.deleteUser(client.testUser,
                            function (err2) {
                            ufds.client.removeAllListeners('close');
                            ufds.client.removeAllListeners('timeout');
                            ufds.removeAllListeners('timeout');
                            ufds.close(function () {
                                return cb(null);
                            });
                        });
                    });
                });
            });
        });
    });
}


function createTestRole(callback) {
    var entry = {
        name: 'test-role',
        uniquemember: [client.subuser.dn],
        memberpolicy: [policy.dn],
        uniquememberdefault: [client.subuser.dn],
        account: client.account.uuid
    };

    client.ufds.addRole(client.account.uuid, entry, function (err, r) {
        if (err) {
            return callback(err);
        }
        client.role = role = r;
        return callback(null, client, server);
    });
}


function createTestPolicy(callback) {
    var entry = {
        name: 'test-policy',
        rule: [
            '* CAN get * IF route::string = getaccount',
            '* CAN get AND head * IF route::string = listusers',
            '* CAN post * IF route::string = createuser',
            'Foobar CAN get * IF route::string = listkeys',
            util.format('%s CAN get * IF route::string = listuserkeys',
                client.testSubUser),
            'CAN post IF route::string = rebootmachine',
            'CAN post IF route::string = createmachine',
            'CAN get IF route::string = getmachine',
            'CAN put'
        ],
        description: 'Policy used by test helper',
        account: client.account.uuid
    };

    client.ufds.addPolicy(client.account.uuid, entry, function (err, p) {
        if (err) {
            return callback(err);
        }
        client.policy = policy = p;
        return createTestRole(callback);
    });
}


function addSubUserKey(callback) {
    var p = __dirname + '/sub_id_rsa';
    return fs.readFile(p + '.pub', 'ascii', function (er1, data) {
        if (er1) {
            return callback(er1);
        }
        client.subPublicKey = data;
        var obj = {
            openssh: data,
            name: 'sub_id_rsa'
        };
        return client.subuser.addKey(obj, function (er2, key) {
            if (er2) {
                return callback(er2);
            }
            return fs.readFile(p, 'ascii', function (er3, d) {
                if (er3) {
                    return callback(er3);
                }
                client.subPrivateKey = d;
                return createTestPolicy(callback);
            });
        });
    });
}


function addUserKey(callback) {
    var p = __dirname + '/id_rsa';
    return fs.readFile(p + '.pub', 'ascii', function (er1, data) {
        if (er1) {
            return callback(er1);
        }
        client.publicKey = publicKey = data;
        var obj = {
            openssh: publicKey,
            name: 'id_rsa'
        };
        return account.addKey(obj, function (er2, key) {
            if (er2) {
                return callback(er2);
            }
            return fs.readFile(p, 'ascii', function (er3, d) {
                if (er3) {
                    return callback(er3);
                }
                client.privateKey = privateKey = d;
                client.ufds = ufds;
                client.teardown = clientTeardown;

                return addSubUserKey(callback);
            });
        });
    });
}


function ufdsConnectCb(callback) {
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

        client.account = account = customer;
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
            client.subuser = subuser = sub;
            return addUserKey(callback);
        });
    });
}


function setupClient(version, callback) {
    if (typeof (version) === 'function') {
        callback = version;
        version = '*';
    }

    client = restify.createJsonClient({
        url: server ? server.url : 'https://127.0.0.1',
        version: version,
        retryOptions: {
            retry: 0
        },
        log: LOG,
        rejectUnauthorized: false,
        signRequest: requestSigner
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
    client.KEY_ID = KEY_ID = '/' + client.testUser + '/keys/id_rsa';
    client.testSubUser = sub_login;
    client.SUB_ID = '/' + client.testUser + '/users/' +
        client.testSubUser + '/keys/sub_id_rsa';

    ufds = new UFDS({
        url: (process.env.UFDS_URL || config.ufds.url ||
            'ldaps://10.99.99.18'),
        bindDN: (config.ufds.bindDN || 'cn=root'),
        bindPassword: (config.ufds.bindPassword || 'secret'),
        log: LOG,
        tlsOptions: {
            rejectUnauthorized: false
        },
        retry: {
            initialDelay: 100
        }
    });

    ufds.once('error', function (err) {
        return callback(err);
    });

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

        ufdsConnectCb(callback);
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
    client.log.info('Polling mahi for %s', apath);
    return checkMahiCache(mahiclient, apath, function (err, ready, res) {
        if (err) {
            return cb(err);
        }
        if (!ready) {
            return setTimeout(function () {
                waitForMahiCache(mahiclient, apath, cb);
            }, (process.env.POLL_INTERVAL || 1000));
        }
        return cb(null, res);
    });
}


// --- Library

module.exports = {

    setup: function (version, callback) {
        if (typeof (version) === 'function') {
            callback = version;
            version = '*';
        }
        assert.ok(callback);

        user = 'a' + uuid().substr(0, 7) + '.test@joyent.com';
        sub_login = 'a' + uuid().substr(0, 7) + '.sub.test@joyent.com';
        if (SDC_SETUP_TESTS) {
            // We already got a running server instance,
            // no need to boot another one:
            return setupClient(version, callback);
        } else {
            config.log = LOG;
            config.test = true;
            server = app.createServer(config, function (s) {
                server = s;
                server.start(function () {
                    LOG.info('CloudAPI listening at %s', server.url);
                    return setupClient(version, callback);
                });
            });
            return server;
        }
    },

    checkHeaders: function (t, headers) {
        assert.ok(t);
        t.ok(headers, 'headers ok');
        t.ok(headers['access-control-allow-origin'], 'headers allow-origin');
        t.ok(headers['access-control-allow-methods'], 'headers allow-methods');
        t.ok(headers.date, 'headers date');
        t.ok(headers['x-request-id'], 'headers x-request-id');
        t.ok(headers['x-response-time'] >= 0, 'headers response time');
        t.ok(headers.server, 'headers server');
        t.equal(headers.connection, 'Keep-Alive', 'headers connection');
        t.ok(headers['x-api-version'], 'headers x-api-version OK');
    },

    checkVersionHeader: function (t, version, headers) {
        assert.ok(t);
        assert.ok(version);
        t.equal(headers['x-api-version'], version,
                util.format('headers x-api-version %s', version));
    },

    getCfg: function () {
        return config;
    },

    checkMahiCache: checkMahiCache,
    waitForMahiCache: waitForMahiCache
};
