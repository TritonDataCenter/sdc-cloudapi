/*
 * Copyright 2014 Joyent, Inc. All rights reserved.
 *
 * Unlike other tests, here we make the client point at the admin user.
 * Adding zones missing network_uuid in the nics isn't simple in tests, but
 * headnode zones are created without them, so we're making use of that fact
 * here by listing the CA zone.
 */



var crypto = require('crypto');
var fs     = require('fs');
var test   = require('tap').test;
var common = require('./common');



var keyPath = __dirname + '/id_rsa';
var keyName = 'cloudapi.test.key.delete.if.seen';

var client, server, account, key, caZone;



test('setup', function (t) {
    common.setup('~7.1', function (err, _client, _server) {
        t.ifError(err);

        client = _client;
        server = _server;

        server._clients.ufds.getUser('admin', function (err2, _account) {
            t.ifError(err2);

            account = _account;

            var publicKey  = fs.readFileSync(keyPath + '.pub', 'ascii');
            var privateKey = fs.readFileSync(keyPath, 'ascii');

            // Add public key to admin user. We're assuming here that this is
            // the same key which common.js loaded into the client.
            return account.addKey({
                openssh: publicKey,
                name: keyName
            }, function (err3, _key) {
                t.ifError(err3);

                key = _key;

                // override the HTTP signature to point at admin user
                client.signRequest = function (req) {
                    var date = req.getHeader('Date');

                    var signer = crypto.createSign('RSA-SHA256');
                    signer.update(date);
                    var signature = signer.sign(privateKey, 'base64');

                    req.setHeader('Authorization',
                                'Signature keyId="/admin/keys/' + keyName +
                                '",algorithm="rsa-sha256" ' + signature);
                };

                t.end();
            });
        });
    });
});



test('ListMachines populates networks', function (t) {
    client.get('/my/machines', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);

        caZone = body.filter(function (zone) {
            return zone.name === 'ca0';
        })[0];

        t.ok(caZone);
        t.ok(caZone.networks);
        t.equal(typeof (caZone.networks[0]), 'string');

        t.end();
    });
});



test('GetMachine populates networks', function (t) {
    client.get('/my/machines/' + caZone.id, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);

        t.ok(body);
        t.ok(body.networks);
        t.equal(typeof (body.networks[0]), 'string');

        t.end();
    });
});




test('ListFirewallRuleMachines populates networks', function (t) {
    client.post('/my/fwrules', {
        description: 'rule from cloudapi test. Delete if found',
        rule: 'FROM vm ' + caZone.id + ' TO subnet 10.99.99.0/24 ' +
                'BLOCK tcp PORT 25'
    }, function (err, req, res, fwRule) {
        t.ifError(err);
        t.equal(res.statusCode, 201);

        var path = '/my/fwrules/' + fwRule.id + '/machines';
        client.get(path, function (err2, req2, res2, zones) {
            t.ifError(err2);
            t.equal(res.statusCode, 201);

            var zone = zones[0];
            t.equal(zone.id, caZone.id);
            t.ok(typeof (zone.networks[0]), 'string');

            client.del('/my/fwrules/' + fwRule.id, function (err3, req3, res3) {
                t.ifError(err3);
                t.equal(res3.statusCode, 204);
                t.end();
            });
        });
    });
});



test('teardown', function (t) {
    account.deleteKey(key, function (err) {
        t.ifError(err);

        client.teardown(function () {
            // Ignore err2 here, just means we have not been able to remove
            // something from ufds.

            if (process.env.SDC_SETUP_TESTS) {
                return t.end();
            }

            Object.keys(server._clients).forEach(function (n) {
                var c = server._clients[n].client;

                if (c && c.close) {
                    c.close();
                }
            });

            server._clients.ufds.client.removeAllListeners('close');

            return server.close(function () {
                t.end();
            });
        });
    });
});
