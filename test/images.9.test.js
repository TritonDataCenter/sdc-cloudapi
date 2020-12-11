/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var test = require('tape');
var common = require('./common');


// --- Globals


var CLIENTS;
var SERVER;


// --- Tests


test('setup', function (t) {
    common.setup({clientApiVersion: '~9'}, function (_, clients, server) {
        CLIENTS = clients;
        SERVER = server;
        t.end();
    });
});

test('Image cloning', function (t) {
    var imageCloneTestSuite = require('./images/clone.js');
    imageCloneTestSuite(t, CLIENTS);
});

test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
