/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Unlike other tests, here we make the client point at the admin user.
 * Adding zones missing network_uuid in the nics isn't simple in tests, but
 * headnode zones are created without them, so we're making use of that fact
 * here by listing the CA zone.
 */

var test   = require('tape').test;
var util   = require('util');
var common = require('./common');


// --- Globals


var KEY_NAME = 'cloudapi.test.key.delete.if.seen';

var CA_ZONE;
var FW_RULE;

var CLIENTS;
var CLIENT;
var OTHER;
var SERVER;


// --- Helpers


// XXX do we really want forbidden over notfound?
function checkForbidden(t, err, req, res, body) {
    t.ok(err);
    t.ok(body);

    t.equal(err.restCode, 'Forbidden');
    t.ok(err.message);

    t.equal(body.code, 'Forbidden');
    t.ok(body.message);

    t.equal(res.statusCode, 403);
}


// --- Tests


test('setup', function (t) {
    common.setup({clientApiVersion: '~7.1'}, function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        OTHER   = clients.other;
        SERVER  = server;

        CLIENT.ufds.getUser('admin', function (err, account) {
            t.ifError(err);

            // Add public key to admin user. We're assuming here that this is
            // the same key which common.js loaded into the client.
            account.addKey({
                openssh: CLIENT.publicKey,
                name: KEY_NAME
            }, function (err2) {
                t.ifError(err2);

                // used by signer to impersonate admin with newly added key
                CLIENT.keyId = '/admin/keys/' + KEY_NAME;

                t.end();
            });
        });
    });
});



test('ListMachines populates networks', function (t) {
    CLIENT.get('/my/machines', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);

        CA_ZONE = body.filter(function (zone) {
            return zone.name === 'ca0';
        })[0];

        t.ok(CA_ZONE);
        t.ok(CA_ZONE.networks);
        t.equal(typeof (CA_ZONE.networks[0]), 'string');

        t.end();
    });
});



test('GetMachine populates networks', function (t) {
    CLIENT.get('/my/machines/' + CA_ZONE.id, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);

        t.ok(body);
        t.ok(body.networks);
        t.equal(typeof (body.networks[0]), 'string');

        t.end();
    });
});



test('Add firewall rule OK', function (t) {
    CLIENT.post('/my/fwrules', {
        description: 'rule from cloudapi test. Delete if found',
        rule: 'FROM vm ' + CA_ZONE.id + ' TO subnet 10.99.99.0/24 ' +
                'BLOCK tcp PORT 25'
    }, function (err, req, res, fwRule) {
        t.ifError(err);
        t.equal(res.statusCode, 201);

        FW_RULE = fwRule;

        t.end();
    });
});



test('ListFirewallRuleMachines populates networks', function (t) {
    var path = '/my/fwrules/' + FW_RULE.id + '/machines';
    CLIENT.get(path, function (err, req, res, zones) {
        t.ifError(err);
        t.equal(res.statusCode, 200);

        t.equal(zones.length, 1);

        var zone = zones[0];
        t.equal(zone.id, CA_ZONE.id);
        t.ok(typeof (zone.networks[0]), 'string');

        t.end();
    });
});



test('ListFirewallRuleMachines - other', function (t) {
    var path = '/my/fwrules/' + FW_RULE.id + '/machines';
    OTHER.get(path, function (err, req, res, body) {
        checkForbidden(t, err, req, res, body);
        t.end();
    });
});



test('Delete firewall rule - other', function (t) {
    OTHER.del('/my/fwrules/' + FW_RULE.id, function (err, req, res, body) {
        checkForbidden(t, err, req, res, body);
        t.end();
    });
});



test('Delete firewall rule OK', function (t) {
    CLIENT.del('/my/fwrules/' + FW_RULE.id, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        t.end();
    });
});



test('ListFirewallRuleMachines populates networks - other', function (t) {
    OTHER.post('/my/fwrules', {
        description: 'rule from cloudapi test. Delete if found',
        rule: 'FROM vm ' + CA_ZONE.id + ' TO subnet 10.99.99.0/24 ' +
                'BLOCK tcp PORT 25'
    }, function (err, req, res, fwRule) {
        t.ifError(err);
        t.equal(res.statusCode, 201);

        FW_RULE = fwRule;

        t.end();
    });
});



test('ListFirewallRuleMachines of unowned machine', function (t) {
    var path = '/my/fwrules/' + FW_RULE.id + '/machines';
    OTHER.get(path, function (err, req, res, zones) {
        t.ifError(err);
        t.equal(zones.length, 0);
        t.end();
    });
});



test('Delete firewall rule OK - other', function (t) {
    OTHER.del('/my/fwrules/' + FW_RULE.id, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        t.end();
    });
});



test('teardown', function (t) {
    CLIENT.ufds.deleteKey('admin', KEY_NAME, function (err) {
        t.ifError(err);

        common.teardown(CLIENTS, SERVER, function (err2) {
            t.ifError(err2, 'teardown success');
            t.end();
        });
    });
});
