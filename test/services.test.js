/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var test = require('tape').test;
var common = require('./common');


// --- Globals


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
    CLIENT.get('/my/services', function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(typeof (body), 'object');
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 200);
        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
