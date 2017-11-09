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
var vasync = require('vasync');
var verror = require('verror');

var common = require('./common');
var mod_config = require('../lib/config.js');
var mod_testConfig = require('./lib/config');
var mod_testNetworks = require('./lib/networks');
var testVolumes = require('./lib/volumes');
var units = require('../lib/units');

var CONFIG = mod_config.configure();
if (CONFIG.experimental_cloudapi_nfs_shared_volumes !== true) {
    console.log('experimental_cloudapi_nfs_shared_volumes setting not ' +
        'enabled, skipping tests');
    process.exitCode = 0;
} else {
    var CLIENTS;
    var CLIENT;
    var SERVER;
    var testVolumeNameUnavailableSize = 'test-volumes-size-default';

    test('setup', function (t) {
        common.setup({clientApiVersion: '~8.0'}, function (_, clients, server) {
            CLIENTS = clients;
            CLIENT  = clients.user;
            SERVER  = server;

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

    test('creating volume with unavailable size should fail', function (t) {
        var largestSize;

        vasync.pipeline({arg: {}, funcs: [
            function getVolumeSizes(ctx, next) {
                CLIENT.volapi.listVolumeSizes(
                    function onListVolSizes(listVolSizesErr, sizes) {
                        t.ifErr(listVolSizesErr,
                            'listing volume sizes should not error');
                        if (listVolSizesErr) {
                            next(listVolSizesErr);
                            return;
                        }

                        t.ok(sizes,
                            'listing volume sizes should not return an empty ' +
                                'response');
                        if (sizes) {
                            t.ok(sizes.length > 0,
                                'listing volume sizes should not return an ' +
                                    'empty list of sizes');
                        }

                        largestSize = sizes[sizes.length - 1].size;

                        next();
                });
            },
            function createVolWithUnavailableSize(ctx, next) {
                var unavailableSize = largestSize + 1;

                CLIENT.post('/my/volumes', {
                    name: testVolumeNameUnavailableSize,
                    size: unavailableSize,
                    type: 'tritonnfs'
                }, function onVolCreated(volumeCreationErr, req, res, volume) {
                    var expectedErrMsg = 'Volume size ' + unavailableSize +
                        ' is not available';
                    var actualErrMsg;

                    t.ok(volumeCreationErr,
                        'creating a volume with unavailable size should error');

                    if (volumeCreationErr) {
                        actualErrMsg = volumeCreationErr.message;
                        t.notEqual(actualErrMsg.indexOf(expectedErrMsg), -1,
                            'error message should include: ' + expectedErrMsg +
                                ', got: ' + volumeCreationErr.message);
                    }

                    next();
                });
            }
        ]}, function onTestDone(err) {
            t.end();
        });
    });

    test('teardown', function (t) {
        common.teardown(CLIENTS, SERVER, function () {
            t.end();
        });
    });
}
