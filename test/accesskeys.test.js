/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */


const test = require('@smaller/tap').test;

const common = require('./common');

var CLIENTS;
var CLIENT;
var OTHER;
var SERVER;
var ACCESS_KEY;


test('setup', function (t) {
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        CLIENT = clients.user;
        OTHER = clients.other;
        SERVER = server;

        t.end();
    });
});


test('ListAccessKeys (empty) OK', function (t) {
    CLIENT.get('/my/accesskeys', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.equal(body.length, 0);
        t.end();
    });
});


test('CreateAccessKey OK', function (t) {
    CLIENT.post('/my/accesskeys', {}, function (err, req, res, createdKey) {
        t.ifError(err);
        t.ok(createdKey);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        t.ok(createdKey.accesskeyid, 'accesskeyid');
        t.ok(createdKey.accesskeysecret, 'accesskeysecret');
        t.ok(createdKey.created, 'access key created');
        t.equal(createdKey.status, 'Active');
        ACCESS_KEY = createdKey;

        CLIENT.get('/my/accesskeys', function (err2, req2, res2, body2) {
            t.ifError(err2);
            t.equal(res2.statusCode, 200);
            common.checkHeaders(t, res2.headers);
            t.ok(body2);
            t.ok(body2.length);
            var key_present = false;
            body2.forEach(function (k) {
                if (k.accesskeyid === createdKey.accesskeyid) {
                    key_present = true;
                }
            });
            t.ok(key_present);
            t.end();
        });
    });
});


test('GetKey OK - other', function (t) {
    var url = '/my/accesskeys/' + ACCESS_KEY.accesskeyid;

    OTHER.get(url, function (err, req, res, body) {
        t.ok(err);
        t.ok(body);

        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);

        t.equal(body.code, 'ResourceNotFound');
        t.ok(body.message);

        t.equal(res.statusCode, 404);

        t.end();
    });
});


test('DeleteAccessKey OK', function (t) {
    var url = '/my/accesskeys/' + ACCESS_KEY.accesskeyid;

    CLIENT.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('DeleteAccessKey 404', function (t) {
    CLIENT.del('/my/accesskeys/' + common.uuid(), function (err) {
        t.ok(err);
        t.equal(err.statusCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);
        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
