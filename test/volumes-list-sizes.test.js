/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var test = require('tape').test;

var common = require('./common');
var mod_config = require('../lib/config.js');
var mod_testConfig = require('./lib/config');

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

    test('should be able to get volume sizes w/ default type',
        function (t) {
            CLIENT.get('/my/volumesizes',
                function onGetVolumeSizes(err, req, res, volumeSizes) {
                    t.ifErr(err, 'GET /my/volumesizes should succeed');
                    t.ok(volumeSizes,
                        'returned volumeSizes should be an object');
                    t.ok(Array.isArray(volumeSizes),
                        'returned volumeSizes should also be an array');
                    t.ok(volumeSizes.length > 0,
                        'should have at least one volumeSize entry');

                    t.end();
                });
    });

    test('should be able to get volume sizes',
        function (t) {
            CLIENT.get('/my/volumesizes?type=tritonnfs',
                function onGetVolumeSizes(err, req, res, volumeSizes) {
                    var idx = 0;
                    var sorted = true;

                    t.ifErr(err, 'GET /my/volumesizes should succeed');
                    t.ok(volumeSizes,
                        'returned volumeSizes should be an object');
                    t.ok(Array.isArray(volumeSizes),
                        'returned volumeSizes should also be an array');
                    t.ok(volumeSizes.length > 0,
                        'should have at least one volumeSize entry');
                    if (volumeSizes.length > 0) {
                        t.ok(volumeSizes[0].size,
                            'volumeSizes[0] should have "size", got: ' +
                            volumeSizes[0].size);
                        t.ok(volumeSizes[0].type,
                            'volumeSizes[0] should have "type", got: ' +
                            volumeSizes[0].type);
                    }

                    // check that volume sizes are in ascending order
                    for (idx = 0; idx < volumeSizes.length; idx++) {
                        if (idx > 0 &&
                            volumeSizes[idx - 1] > volumeSizes[idx]) {

                            sorted = false;
                        }
                    }
                    t.ok(sorted, 'volume sizes should be in ascending order');

                    t.end();
                });
    });

    test(' GET /my/volumesizes?type=invalidType should fail', function (t) {
        CLIENT.get('/my/volumesizes?type=invalidType',
            function onGetVolumeSizes(err, req, res, body) {
                t.ok(err, 'expected error listing volume sizes, got: ' +
                    (err ? err.message : JSON.stringify(err)));
                t.ok(body, 'expected to get a body');
                if (body) {
                    t.equal(body.message, 'Invalid volume type: invalidType. ' +
                        'Volume type should be one of: tritonnfs',
                        'expected body to be an invalid type error');
                }
                t.end();
            });
    });

    test('teardown', function (t) {
        common.teardown(CLIENTS, SERVER, function () {
            t.end();
        });
    });
}
