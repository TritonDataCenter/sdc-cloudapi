/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

var test = require('tape').test;
var common = require('./common');


// --- Globals


var CLIENTS;
var CLIENT;
var SERVER;
var TEST;


// --- Tests


test('setup', function (t) {
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        SERVER  = server;

        TEST = common.getCfg().test;

        t.end();
    });
});


test('uncaughtException handler OK', function (t) {
    if (!TEST) {
        return t.end();
    }

    return CLIENT.get('/my/tests/throw_exception',
            function (err, req, res, body) {
        t.ok(err);
        t.equal(res.statusCode, 500);

        t.deepEqual(body, {
            code: 'InternalError',
            message: 'Internal Error'
        });

        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
