/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var libuuid = require('libuuid');
var test = require('tape').test;

var common = require('./common');
var mod_config = require('../lib/config.js');

var CONFIG = mod_config.configure();

if (CONFIG.experimental_cloudapi_nfs_shared_volumes !== true) {
    console.log('experimental_cloudapi_nfs_shared_volumes setting not ' +
        'enabled, skipping tests');
    process.exitCode = 0;
} else {
    var CLIENTS;
    var CLIENT;
    var SERVER;

    test('setup', function (t) {
        common.setup({clientApiVersion: '~8.0'}, function (_, clients, server) {
            CLIENTS = clients;
            CLIENT = clients.user;
            SERVER = server;

            t.end();
        });
    });

    test('getting non-existing volume should respond with 404 status code',
        function (t) {
            CLIENT.get('/my/volumes/' + libuuid.create(),
                function onVolumeGet(volGetErr, req, res, volume) {
                    var expectedErrCode = 'VolumeNotFound';
                    var expectedStatusCode = 404;

                    t.equal(res.statusCode, expectedStatusCode,
                        'response status code should be ' + expectedStatusCode);
                    t.equal(volGetErr.body.code, expectedErrCode,
                        'error code should be: ' + expectedErrCode);
                    t.end();
                });
        });

    test('teardown', function (t) {
        common.teardown(CLIENTS, SERVER, function () {
            t.end();
        });
    });
}