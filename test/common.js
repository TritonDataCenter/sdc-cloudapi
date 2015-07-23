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
var util = require('util');
var fs = require('fs');
var vasync = require('vasync');

var UFDS = require('sdc-clients').UFDS;
var VMAPI = require('sdc-clients').VMAPI;
var CNAPI = require('sdc-clients').CNAPI;
var NAPI = require('sdc-clients').NAPI;
var IMGAPI = require('sdc-clients').IMGAPI;
var PAPI = require('sdc-clients').PAPI;
var MAHI = require('mahi');

var app = require('../lib').app;
var apertureConfig = require('aperture-config').config;


// --- Globals


var SDC_128_PACKAGE = {
    uuid: '897779dc-9ce7-4042-8879-a4adccc94353',
    name: 'sdc_128_ok',
    version: '1.0.0',
    max_physical_memory: 128,
    quota: 10240,
    max_swap: 512,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    fss: 25,
    'default': false,
    vcpus: 1,
    active: true
};

var PASSWD = 'secret123';
var DEFAULT_CFG = path.join(__dirname, '..', '/etc/cloudapi.cfg');

var LOG = new Logger({
    level: process.env.LOG_LEVEL || 'info',
    name: 'cloudapi_unit_test',
    stream: process.stderr,
    serializers: restify.bunyan.serializers
});

var CONFIG = {};
try {
    CONFIG = JSON.parse(fs.readFileSync(DEFAULT_CFG, 'utf8'));
} catch (e) {}

var SIGNATURE_FMT = 'Signature keyId="%s",algorithm="%s" %s';


// --- Functions


function uuid() {
    return libuuid.create();
}


function requestSigner(req, keyId, privateKey) {
    var d = req.getHeader('Date');

    if (!d) {
        d = new Date().toUTCString();
        req.setHeader('Date', d);
    }

    var alg = 'RSA-SHA256';

    var signer = crypto.createSign(alg);
    signer.update(d);
    var sig = signer.sign(privateKey, 'base64');

    var authHeader = util.format(SIGNATURE_FMT, keyId, alg.toLowerCase(), sig);
    req.setHeader('Authorization', authHeader);
}


// Unavoidably, we need to poll some jobs
function _wfapi() {
    return restify.createJsonClient({
        url: process.env.WFAPI_URL || CONFIG.wfapi.url || 'http://10.99.99.19',
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
        url: process.env.VMAPI_URL || CONFIG.vmapi.url || 'http://10.99.99.28',
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
        url: process.env.CNAPI_URL || CONFIG.cnapi.url || 'http://10.99.99.22',
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
        url: process.env.NAPI_URL || CONFIG.napi.url || 'http://10.99.99.10',
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
        url: process.env.IMGAPI_URL || CONFIG.imgapi.url ||
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
        url: process.env.PAPI_URL || CONFIG.papi.url || 'http://10.99.99.30',
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
        url: process.env.MAHI_URL || CONFIG.mahi.url ||
        'http://10.99.99.34:8080',
        typeTable: apertureConfig.typeTable,
        maxAuthCacheSize: 1,
        maxAuthCacheAgeMs: 5
    });
}


function _ufds() {
    return new UFDS({
        url: process.env.UFDS_URL || CONFIG.ufds.url || 'ldaps://10.99.99.18',
        bindDN: CONFIG.ufds.bindDN || 'cn=root',
        bindPassword: CONFIG.ufds.bindPassword || 'secret',
        log: LOG,
        tlsOptions: {
            rejectUnauthorized: false
        },
        retry: {
            initialDelay: 100
        }
    });
}


function clientTeardown(client, cb) {
    client.close();
    client.mahi.close();

    var ufds = client.ufds;

    // we ignore errors until the end and try to clean up as much as possible
    ufds.deleteKey(client.login, 'id_rsa', function (err) {
        ufds.deleteUser(client.login, function (err2) {
            ufds.client.removeAllListeners('close');
            ufds.client.removeAllListeners('timeout');
            ufds.removeAllListeners('timeout');

            ufds.close(function () {
                return cb(err || err2);
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


function createTestRole(client, subUserAccount, cb) {
    var entry = {
        name: 'test-role',
        uniquemember: [subUserAccount.dn],
        memberpolicy: [client.policy.dn],
        uniquememberdefault: [subUserAccount.dn],
        account: client.account.uuid
    };

    client.ufds.addRole(client.account.uuid, entry, function (err, role) {
        if (err) {
            return cb(err);
        }

        client.role = role;

        return cb();
    });
}


function createTestPolicy(client, cb) {
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
            return cb(err);
        }

        client.policy = policy;

        return cb();
    });
}


function addUserKey(client, keyPath, cb) {
    var publicKey  = fs.readFileSync(keyPath + '.pub', 'ascii');
    var privateKey = fs.readFileSync(keyPath, 'ascii');

    client.publicKey = publicKey;
    client.privateKey = privateKey;

    var obj = {
        openssh: publicKey,
        name: 'id_rsa'
    };

    return client.account.addKey(obj, cb);
}


function addUser(client, keyPath, parentAccount, cb) {
    var ufds = client.ufds;

    var entry = {
        login: client.login,
        email: client.login,
        userpassword: client.passwd,
        registered_developer: true,
        approved_for_provisioning: true
    };

    if (parentAccount) {
        entry.account = parentAccount.uuid;
    } else {
        entry.registered_developer = true;
        entry.approved_for_provisioning = true;
    }

    return ufds.addUser(entry, function (err, customer) {
        if (err) {
            return cb(err);
        }

        client.account = customer;

        return addUserKey(client, keyPath, cb);
    });
}


function setupClient(version, serverUrl, user, keyId, keyPath, parentAcc, cb) {
    if (typeof (version) === 'function') {
        cb = version;
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
            requestSigner(req, client.keyId, client.privateKey);
        }
    });

    client.login = user;
    client.passwd = PASSWD;
    client.keyId = keyId;

    // Create clients to all the APIs
    client.wfapi  = _wfapi();
    client.vmapi  = _vmapi();
    client.cnapi  = _cnapi();
    client.napi   = _napi();
    client.imgapi = _imgapi();
    client.papi   = _papi();
    client.mahi   = _mahi();
    client.ufds   = _ufds();

    var ufds = client.ufds;

    ufds.once('error', cb);

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

        addUser(client, keyPath, parentAcc, function (err) {
            cb(err, client);
        });
    });
}


function loadServer(cb) {
    if (process.env.SDC_SETUP_TESTS) {
        var serverObj = {
            url: process.env.SDC_SETUP_URL || 'https://127.0.0.1'
        };

        return cb(null, serverObj);
    }

    CONFIG.test = true;

    return app.createServer(CONFIG, function (err, server) {
        if (err) {
            return cb(err);
        }

        return server.start(function () {
            LOG.info('CloudAPI listening at %s', server.url);
            cb(null, server);
        });
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

        var keyPath = __dirname + '/testkeys/id_rsa.pub';
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
    var userKeyPath = __dirname + '/testkeys/id_rsa';
    var userKeyId = '/' + user + '/keys/id_rsa';

    var subUser = 'a' + uuid().substr(0, 7) + '.sub.test@joyent.com';
    var subUserKeyPath = __dirname + '/testkeys/sub_id_rsa';
    var subUserKeyId = '/' + user + '/users/' + subUser + '/keys/id_rsa';

    var otherUser = 'a' + uuid().substr(0, 7) + '.other.test@joyent.com';
    var otherUserKeyPath = __dirname + '/testkeys/other_id_rsa';
    var otherUserKeyId = '/' + otherUser + '/keys/other_id_rsa';

    CONFIG.log = LOG;

    var userClient;
    var subUserClient;
    var otherUserClient;
    var server;

    vasync.pipeline({ funcs: [
        function setupServer(_, next) {
            loadServer(function (err, _server) {
                server = _server;
                next(err);
            });
        },
        function setupUserClient(_, next) {
            setupClient(version, server.url, user, userKeyId, userKeyPath,
                        null, function (err, client) {
                userClient = client;
                next(err);
            });
        },
        function setupSubUserClient(_, next) {
            setupClient(version, server.url, subUser, subUserKeyId,
                        subUserKeyPath, userClient.account,
                        function (err, client) {
                subUserClient = client;
                next(err);
            });
        },
        function setupOtherClient(_, next) {
            setupClient(version, server.url, otherUser, otherUserKeyId,
                        otherUserKeyPath, null, function (err, client) {
                otherUserClient = client;
                next(err);
            });
        },
        function setupPolicy(_, next) {
            createTestPolicy(userClient, next);
        },
        function setupRole(_, next) {
            createTestRole(userClient, subUserClient.account, next);
        },
        function setupPackage(_, next) {
            addPackage(userClient, SDC_128_PACKAGE, next);
        }
    ] }, function (err) {
        if (err) {
            throw err;
        }

        assert(userClient);
        assert(subUserClient);
        assert(otherUserClient);
        assert(server);

        var clients = {
            user: userClient,
            subuser: subUserClient,
            other: otherUserClient
        };

        cb(null, clients, server);
    });
}


function teardown(clients, server, cb) {
    assert(clients);
    assert(server);
    assert(cb);

    var userClient      = clients.user;
    var subUserClient   = clients.subuser;
    var otherUserClient = clients.other;

    var ufds    = userClient.ufds;
    var accUuid = userClient.account.uuid;

    // ignore all errors; try to clean up as much as possible
    ufds.deleteRole(accUuid, userClient.role.uuid, function () {
        ufds.deletePolicy(accUuid, userClient.policy.uuid, function () {
            deletePackage(userClient, SDC_128_PACKAGE, function () {
                clientTeardown(subUserClient, function () {
                    clientTeardown(userClient, function () {
                        clientTeardown(otherUserClient, function () {
                            if (server.close) {
                                server.close(cb);
                            } else {
                                cb();
                            }
                        });
                    });
                });
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


function addPackage(client, pkg, cb) {
    client.papi.get(pkg.uuid, {}, function (err, p) {
        if (!err) {
            return cb(null, p);
        }

        if (err.restCode === 'ResourceNotFound') {
            return client.papi.add(pkg, cb);
        } else {
            return cb(err);
        }
    });
}


function deletePackage(client, pkg, cb) {
    client.papi.del(pkg.uuid, { force: true }, cb);
}


function getHeadnode(client, cb) {
    client.cnapi.listServers({ extras: 'sysinfo' }, function (err, servers) {
        if (err) {
            return err;
        }

        var headnode = servers.filter(function (s) {
            return s.headnode;
        })[0];

        return cb(null, headnode);
    });
}


function getBaseDataset(client, cb) {
    client.get('/my/datasets?name=base', function (err, req, res, body) {
        if (err) {
            return err;
        }

        var dataset = body.filter(function (d) {
            return d.version && d.version === '13.4.0';
        })[0];

        return cb(null, dataset);
    });
}


// --- Library


module.exports = {
    setup: setup,
    teardown: teardown,
    checkHeaders: checkHeaders,
    checkReqId: checkReqId,
    checkVersionHeader: checkVersionHeader,
    checkMahiCache: checkMahiCache,
    waitForMahiCache: waitForMahiCache,
    withTemporaryUser: withTemporaryUser,
    uuid: uuid,
    addPackage: addPackage,
    deletePackage: deletePackage,
    getHeadnode: getHeadnode,
    getBaseDataset: getBaseDataset,

    sdc_128_package: SDC_128_PACKAGE,

    getCfg: function () {
        return CONFIG;
    }
};
