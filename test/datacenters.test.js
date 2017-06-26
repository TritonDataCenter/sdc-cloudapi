/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var test = require('tape').test;
var common = require('./common');


// --- Globals


var DC_NAME = process.env.DATACENTER ||
            Object.keys(common.getCfg().datacenters)[0];

var CLIENTS;
var CLIENT;
var SERVER;


// --- Tests


test('setup', function (t) {
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        SERVER  = server;

        t.end();
    });
});


test('ListDatacenters OK', function (t) {
    CLIENT.get('/my/datacenters', function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 200);
        t.ok(body[DC_NAME]);
        t.end();
    });
});


test('GetDatacenter OK', function (t) {
    CLIENT.get('/my/datacenters/' + DC_NAME, function (err, req, res, body) {
        t.ifError(err);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 302);
        t.equal(body.code, 'ResourceMoved');
        t.ok(body.message);
        t.end();
    });
});


test('GetDatacenter 404', function (t) {
    CLIENT.get('/my/datacenters/' + common.uuid(), function (err) {
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
