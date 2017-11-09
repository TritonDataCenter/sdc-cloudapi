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
var verror = require('verror');

var common = require('./common');
var mod_config = require('../lib/config.js');
var mod_testConfig = require('./lib/config');
var mod_testNetworks = require('./lib/networks');
var mod_testVolumes = require('./lib/volumes');

var CONFIG = mod_config.configure();

if (CONFIG.experimental_cloudapi_nfs_shared_volumes !== true) {
    console.log('experimental_cloudapi_nfs_shared_volumes setting not ' +
        'enabled, skipping tests');
    process.exitCode = 0;
} else {
    var CLIENTS;
    var CLIENT;
    var SERVER;
    var USER;

    test('setup', function (t) {
        common.setup({clientApiVersion: '~8.0'},
            function onSetupDone(_, clients, server) {
                CLIENTS = clients;
                CLIENT = clients.user;
                SERVER = server;

                t.end();
            });
    });

    /*
     * This is necessary so that we proceed with the rest of the tests suite
     * only after the entry for the newly added user is present in UFDS.
     */
    test('getting config from ufds', function (t) {
        mod_testConfig.waitForAccountConfigReady(CLIENT,
            function onConfigReady(configReadyErr, ufdsConfig) {
                t.ifErr(configReadyErr, 'newly created user\'s config should ' +
                    'eventually be created');
                t.end();
            });
    });

    test('getting user account from ufds', function (t) {
        CLIENT.ufds.getUser(CLIENT.login, function onGetUser(getUserErr, user) {
            USER = user;
            t.end();
        });
    });

    test('deleting user\'s dclocalconfig to remove default fabric network',
        function (t) {
            CLIENT.ufds.deleteDcLocalConfig(USER.uuid,
                USER.dclocalconfig.dclocalconfig,
                function onDcLocalCfgUpdated(err) {
                    t.ifError(err, 'deleting dclocalconfig should succeed');
                    t.end();
                });
        });

    test('creating volume with default params should fail',
        function (t) {
            CLIENT.post('/my/volumes', {
                name: 'test-volumes-no-fabric-network',
                type: 'tritonnfs'
            }, function onVolumeCreated(volumeCreationErr, req, res, body) {
                var expectedStatusCode = 409;
                var expectedErrMsg =
                    'default_network is not configured for account';
                var expectedErrorCode =
                    'DefaultFabricNetworkNotConfiguredError';

                t.ok(volumeCreationErr,
                    'creating a volume with default parameters should error');
                t.equal(volumeCreationErr.statusCode, expectedStatusCode,
                    'response status code should be ' + expectedStatusCode +
                        ', was' + volumeCreationErr.statusCode);
                t.equal(body.code, expectedErrorCode,
                    'body\'s code should be ' + expectedErrorCode + ', was ' +
                        body.code);
                t.equal(body.message, expectedErrMsg,
                    'body\'s message should be ' + expectedErrMsg + ', was ' +
                        body.message);

                t.end();
            });
    });

    test('teardown', function (t) {
        common.teardown(CLIENTS, SERVER, function (teardownErr) {
            t.ifError(teardownErr,
                'tearing down test suite should not error, got: ' +
                    teardownErr);
            t.end();
        });
    });
}
