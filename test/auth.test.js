// Copyright 2013 Joyent, Inc.  All rights reserved.

var util = require('util');
var fs = require('fs');
var crypto = require('crypto');
var qs = require('querystring');

var test = require('tap').test;
var uuid = require('node-uuid');
var restify = require('restify');

var common = require('./common');

// --- Globals

var SIGNATURE = 'Signature keyId="%s",algorithm="%s" %s';
var client, server, account;
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
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
        }
        server = _server;
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


function createToken(t, callback) {
    var opts = {
        keyid: encodeURIComponent(KEY_ID),
        nonce: encodeURIComponent('whateveryouwant'),
        now: encodeURIComponent(new Date().toISOString()),
        permissions: encodeURIComponent(JSON.stringify({
            cloudapi: ['/my/keys/*', '/my/keys']
        })),
        returnto: encodeURIComponent(client.url)
    };

    var query = qs.stringify(opts);
    var urlstring = encodeURIComponent(SDC_SSO_URI + '/login?' + query);
    var signer = crypto.createSign('SHA256');
    signer.update(urlstring);
    var signature = signer.sign(privateKey, 'base64');

    opts.sig = signature;

    opts.username = 'admin';
    opts.password = 'joypass123';

    var ssoClient = restify.createJsonClient({
        url: SDC_SSO_URI,
        version: '*'
    });

    opts.username = 'admin';
    opts.password = 'joypass123';

    ssoClient.post('/login', opts, function (err, req, res, obj) {
        t.ifError(err, 'Create Token Error');
        t.equal(301, res.statusCode, 'Create Toke Status');
        t.ok(obj);
        t.ok(obj.data);
        t.ok(obj.hash);
        if (err) {
            return callback(err);
        } else {
            return callback(null, obj);
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
                path: '/my/keys',
                headers: {
                    Date: now
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

            var sigClient = restify.createJsonClient({
                url: server ? server.url : 'https://127.0.0.1',
                version: '*',
                retryOptions: {
                    retry: 0
                },
                log: client.log
            });

            sigClient.get(obj, function (er1, req, res, body) {
                t.ifError(er1);
                t.equal(res.statusCode, 200);
                common.checkHeaders(t, res.headers);
                t.ok(/Signature/.test(req._headers.authorization));
                t.ok(body);
                t.ok(Array.isArray(body));
                // This is admin user, which has no keys
                t.ok(!body.length);
                t.end();
            });

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
