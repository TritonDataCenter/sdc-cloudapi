// Copyright 2013 Joyent, Inc. All rights reserved.
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
var Package = require('sdc-clients').Package;
var app = require('../lib').app;
var util = require('util');
var fs = require('fs');

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

var user, ufds, client, server, account;

config.keyapi = config.keyapi || process.env.KEYAPI_URL;
var SIGNATURE = 'Signature keyId="%s",algorithm="%s" %s';
var KEY_ID;
var fingerprint = '66:ca:1c:09:75:99:35:69:be:91:08:25:03:c0:17:c0';
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

    client.wfapi = restify.createJsonClient({
        url: process.env.WFAPI_URL || config.wfapi.url || 'http://10.99.99.19',
        version: '*',
        retryOptions: {
            retry: 0
        },
        log: LOG,
        agent: false
    });

    client.testUser = user;
    KEY_ID = '/' + client.testUser + '/keys/id_rsa';
    // We need vmapi client to check jobs on tests, given if we
    // just wait for vmachine status change, we'll be just
    // hanging forever.
    client.vmapi = new VMAPI({
        url: process.env.VMAPI_URL || config.vmapi.url || 'http://10.99.99.28',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: client.log,
        agent: false
    });
    // Given DAPI will never pick Headnode as a server to provision to, we need
    // to explicitly tell we want it:
    client.cnapi = new CNAPI({
        url: process.env.CNAPI_URL || config.cnapi.url || 'http://10.99.99.22',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: client.log,
        agent: false
    });

    client.napi = new NAPI({
        url: process.env.NAPI_URL || config.napi.url || 'http://10.99.99.10',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: client.log,
        agent: false
    });

    client.imgapi = new IMGAPI({
        url: process.env.IMGAPI_URL || config.imgapi.url ||
            'http://10.99.99.21',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: client.log,
        agent: false
    });

    ufds = new UFDS({
        url: (process.env.UFDS_URL || config.ufds.url || 'ldaps://10.99.99.18'),
        bindDN: (config.ufds.bindDN || 'cn=root'),
        bindPassword: (config.ufds.bindPassword || 'secret'),
        log: LOG,
        tlsOptions: {
            rejectUnauthorized: false
        }
    });

    ufds.once('error', function (err) {
        return callback(err);
    });

    ufds.once('connect', function () {
        var entry = {
            login: client.testUser,
            email: client.testUser,
            userpassword: PASSWD
        };
        return ufds.addUser(entry, function (err, customer) {
            if (err) {
                return callback(err);
            }

            account = customer;
            var p = __dirname + '/id_rsa';
            return fs.readFile(p + '.pub', 'ascii', function (er1, data) {
                if (er1) {
                    return callback(er1);
                }
                publicKey = data;
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
                        privateKey = d;
                        client.ufds = ufds;
                        client.pkg = new Package(ufds);
                        client.teardown = function teardown(cb) {
                            client.close();
                            client.ufds.deleteKey(client.testUser, 'id_rsa',
                                function (er4) {
                                    client.ufds.deleteUser(client.testUser,
                                        function (err2) {
                                            ufds.client.removeAllListeners(
                                                'close');
                                            ufds.client.removeAllListeners(
                                                'timeout');
                                            ufds.removeAllListeners('timeout');
                                            ufds.close(function () {
                                                return cb(null);
                                            });
                                        });
                                });
                        };

                        return callback(null, client, server);
                    });
                });
            });
        });
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

        user = 'a' + uuid().substr(0, 7) + '@joyent.com';
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
    }
};
