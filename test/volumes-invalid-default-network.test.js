/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var libuuid = require('libuuid');
var test = require('@smaller/tap').test;

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
    var NAPI_CLIENT;
    var SERVER;
    var UFDS_CLIENT;

    var externalNetwork;
    var testVolumeName = 'test-volumes-basic';

    test('setup', function (t) {
        common.setup({clientApiVersion: '~8.0'}, function (_, clients, server) {
            CLIENTS = clients;
            CLIENT = clients.user;
            SERVER = server;

            NAPI_CLIENT = CLIENT.napi;
            UFDS_CLIENT = CLIENT.ufds;

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

    test('setting default network to non-existing network', function (t) {
        UFDS_CLIENT.updateDcLocalConfig(CLIENT.account.uuid,
            CONFIG.datacenter_name, {
            dclocalconfig: CONFIG.datacenter_name,
            defaultFabricSetup: 'false',
            defaultNetwork: libuuid.create()
        }, function onDcLocalConfigUpdated(updateErr) {
            t.ifErr(updateErr, 'updating dclocalconfig should not error');
            t.end();
        });
    });

    test('creating volume with default net === non-existing net should fail',
        function (t) {
        CLIENT.post('/my/volumes', {
            name: testVolumeName,
            type: 'tritonnfs'
        }, function onVolumeCreated(volumeCreationErr, req, res) {
            var expectedErrName = 'InvalidNetworksError';
            var expectedRestCode = 'InvalidNetworks';
            var expectedStatusCode = 409;

            t.ok(volumeCreationErr,
                'creating a volume with default parameters should fail');

            if (volumeCreationErr) {
                t.equal(volumeCreationErr.statusCode, expectedStatusCode,
                    'status code should be: ' + expectedStatusCode + ', got: ' +
                        volumeCreationErr.statusCode);
                t.equal(volumeCreationErr.restCode, expectedRestCode,
                    'rest code should be: ' + expectedRestCode + ', got: ' +
                        volumeCreationErr.restCode);
                t.equal(volumeCreationErr.name, expectedErrName,
                    'error name should be: ' + expectedErrName + ', got: ' +
                        volumeCreationErr.name);
            }

            t.end();
        });
    });

    test('getting external network should succeed', function (t) {
        NAPI_CLIENT.listNetworks({name: 'external'},
            function onListNets(listNetsErr, nets) {
                t.ifErr(listNetsErr, 'listing networks should not error');
                if (nets) {
                    t.equal(nets.length, 1,
                        'there should be one and only one external network');
                    externalNetwork = nets[0];
                }
                t.end();
            });
    });

    test('setting default network to non-fabric network', function (t) {
        UFDS_CLIENT.updateDcLocalConfig(CLIENT.account.uuid,
            CONFIG.datacenter_name, {
            dclocalconfig: CONFIG.datacenter_name,
            defaultFabricSetup: 'false',
            defaultNetwork: externalNetwork.uuid
        }, function onDcLocalConfigUpdated(updateErr) {
            t.ifErr(updateErr, 'updating dclocalconfig should not error');
            t.end();
        });
    });

    test('creating volume with default net === external should fail',
        function (t) {
        CLIENT.post('/my/volumes', {
            name: testVolumeName,
            type: 'tritonnfs'
        }, function onVolumeCreated(volumeCreationErr, req, res) {
            var expectedErrName = 'InvalidNetworksError';
            var expectedRestCode = 'InvalidNetworks';
            var expectedStatusCode = 409;

            t.ok(volumeCreationErr,
                'creating a volume with default parameters should fail');

            if (volumeCreationErr) {
                t.equal(volumeCreationErr.statusCode, expectedStatusCode,
                    'status code should be: ' + expectedStatusCode + ', got: ' +
                        volumeCreationErr.statusCode);
                t.equal(volumeCreationErr.restCode, expectedRestCode,
                    'rest code should be: ' + expectedRestCode + ', got: ' +
                        volumeCreationErr.restCode);
                t.equal(volumeCreationErr.name, expectedErrName,
                    'error name should be: ' + expectedErrName + ', got: ' +
                        volumeCreationErr.name);
            }

            t.end();
        });
    });

    test('teardown', function (t) {
        common.teardown(CLIENTS, SERVER, function onTeardown(err) {
            t.ifErr(err, 'teardown should be successful, got: ' + err);
            t.end();
        });
    });
}
