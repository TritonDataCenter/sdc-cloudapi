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

if (CONFIG.experimental_nfs_shared_volumes !== true) {
    console.log('experimental_nfs_shared_volumes setting not enabled, ' +
        'skipping tests');
    process.exitCode = 0;
} else {
    var CLIENTS;
    var CLIENT;
    var SERVER;

    var testVolumeName = common.createResourceName('test-volumes-basic');
    var testVolume;
    var testVolumeStorageVmUuid;

    test('setup', function (t) {
        common.setup({clientApiVersion: '~8.0'}, function (_, clients, server) {
            CLIENTS = clients;
            CLIENT = clients.user;
            SERVER = server;

            t.end();
        });
    });

    /*
     * This is necessary so that we proceed with the rest of the tests suite
     * only after the entry for the newly added user (including its default
     * fabric network used to provision volumes) is present in UFDS.
     */
    test('getting config from ufds', function (t) {
        mod_testConfig.waitForAccountConfigReady(CLIENT,
            function onConfigReady(configReadyErr) {
                t.ifErr(configReadyErr, 'newly created user\'s config should ' +
                    'eventually be created');
                t.end();
            });
    });

    test('should be able to get volume sizes',
        function (t) {
            CLIENT.get('/my/volumes/sizes?type=tritonnfs',
                function onGetVolumeSizes(err, req, res, volumeSizes) {
                    t.ifErr(err, 'GET /my/volumes/sizes should succeed');
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
                        t.ok(volumeSizes[0].description,
                            'volumeSizes[0] should have "description", got: ' +
                            volumeSizes[0].description);
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
