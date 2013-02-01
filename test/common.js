// Copyright 2012 Joyent, Inc. All rights reserved.
var assert = require('assert');
var crypto = require('crypto');
var path = require('path');
var Logger = require('bunyan');
var restify = require('restify');
var uuid = require('node-uuid');
var UFDS = require('sdc-clients').UFDS;
var VMAPI = require('sdc-clients').VMAPI;
var CNAPI = require('sdc-clients').CNAPI;
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


function getAuthHeaders() {
    var now = new Date().toUTCString();
    var alg = 'RSA-SHA256';
    var signer = crypto.createSign(alg);
    signer.update(now);
    return {
        Date: now,
        Authorization: util.format(SIGNATURE,
                                    KEY_ID,
                                    alg.toLowerCase(),
                                    signer.sign(privateKey, 'base64'))
    };
}

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

function setupClient(callback) {
    client = restify.createJsonClient({
        url: server ? server.url : 'https://127.0.0.1',
        version: '*',
        retryOptions: {
            retry: 0
        },
        log: LOG,
        agent: false,
        signRequest: requestSigner
    });

    // client.basicAuth(user, PASSWD);
    client.testUser = user;
    KEY_ID = '/' + client.testUser + '/keys/id_rsa';
    // We need vmapi client to check jobs on tests, given if we
    // just wait for vmachine status change, we'll be just
    // hanging forever.
    client.vmapi = new VMAPI({
        url: process.env.VMAPI_URL || config.vmapi.url || 'http://10.99.99.23',
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
        url: process.env.CNAPI_URL || config.cnapi.url || 'http://10.99.99.18',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: client.log,
        agent: false
    });

    ufds = new UFDS({
        url: (process.env.UFDS_URL || config.ufds.url || 'ldaps://10.99.99.14'),
        bindDN: (config.ufds.bindDN || 'cn=root'),
        bindPassword: (config.ufds.bindPassword || 'secret')
    });

    ufds.on('error', function (err) {
        return callback(err);
    });

    ufds.on('ready', function () {
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
                            client.ufds.deleteKey(client.testUser, 'id_rsa',
                                function (er4) {
                                    client.ufds.deleteUser(client.testUser,
                                        function (err2) {
                                            return ufds.close(function () {
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

    setup: function (callback) {
        assert.ok(callback);

        user = 'a' + uuid().substr(0, 7) + '@joyent.com';
        if (SDC_SETUP_TESTS) {
            // We already got a running server instance,
            // no need to boot another one:
            return setupClient(callback);
        } else {
            server = app.createServer({
                config: DEFAULT_CFG,
                log: LOG,
                name: 'cloudapi_tests',
                overrides: {},
                test: true
            }, function (s) {
                server = s;
                server.start(function () {
                    LOG.info('CloudAPI listening at %s', server.url);
                    return setupClient(callback);
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
        t.equal(headers.server, 'Joyent SmartDataCenter 7.0.0',
                'headers server');
        t.equal(headers.connection, 'close', 'headers close');
        t.equal(headers['x-api-version'], '7.0.0', 'headers x-api-version');
    },

    getCfg: function () {
        return config;
    }
};
