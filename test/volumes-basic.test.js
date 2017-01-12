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
var mod_testNetworks = require('./lib/networks');
var mod_testVolumes = require('./lib/volumes');

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

    test('creating volume with default params should be successful',
        function (t) {
            CLIENT.post('/my/volumes', {
                name: testVolumeName,
                type: 'tritonnfs'
            }, function onVolumeCreated(volumeCreationErr, req, res, volume) {
                var expectedState = 'creating';
                var expectedType = 'tritonnfs';

                testVolume = volume;

                t.ifErr(volumeCreationErr,
                    'creating a volume with default parameters should not ' +
                        'error');
                t.ok(testVolume, 'returned volume should be an object');
                t.equal(testVolume.type, 'tritonnfs',
                    'newly created volume should have type \'' + expectedType +
                        '\'');
                t.equal(testVolume.state, 'creating',
                    'volume should have state \'' + expectedState + '\'');

                t.end();
            });
    });

    test('listing volumes should include newly created volume', function (t) {
        CLIENT.get('/my/volumes',
            function onVolumesListed(volumesListErr, req, res, volumes) {
                var volumesWithNewlyCreatedVolumeName;

                t.ifErr(volumesListErr, 'listing volumes shoult not error');
                t.ok(Array.isArray(volumes),
                    'response should be an array of volumes');
                t.ok(volumes.length >= 1,
                    'volumes array should have at least one item');
                volumesWithNewlyCreatedVolumeName =
                    volumes.filter(function hasNewlyCreatedVolumeName(volume) {
                        return volume.name === testVolumeName;
                    });
                t.ok(volumesWithNewlyCreatedVolumeName.length, 1,
                    'Only one volume should have name ' + testVolumeName);

                t.end();
            });
    });

    test('getting newly created volume should succeeded', function (t) {
        CLIENT.get('/my/volumes/' + testVolume.uuid,
            function onGetVolume(getVolumeErr, req, res, volume) {
                t.ifErr(getVolumeErr,
                    'getting newly created volume should not error');
                t.ok(typeof (volume) === 'object' && volume !== null,
                    'response should be a non-null object ');
                t.equal(volume.name, testVolumeName,
                    'volume name should be \'' + testVolumeName + '\'');

                t.end();
            });
    });

    test('volume should eventually transition to state \'ready\'',
        function (t) {
            var expectedState = 'ready';

            mod_testVolumes.waitForTransitionToState(CLIENT, testVolume.uuid,
                expectedState, function onTransition() {
                    CLIENT.get('/my/volumes/' + testVolume.uuid,
                        function onGetVolume(getVolumeErr, req, res, volume) {
                            t.ifErr(getVolumeErr,
                                'getting newly created volume should not ' +
                                    'error');
                            t.ok(typeof (volume) === 'object' &&
                                volume !== null,
                                    'response should be a non-null object');
                            t.equal(volume.name, testVolumeName,
                                'volume name should be \'' + testVolumeName +
                                    '\'');
                            t.equal(volume.state, expectedState,
                                'volume should have transitioned to state \'' +
                                    expectedState + '\'');

                            t.end();
                        });
            });
    });

    test('deleting volume should be successful', function (t) {
        CLIENT.del('/my/volumes/' + testVolume.uuid,
            function onDelVolume(delVolumeErr) {
                t.ifErr(delVolumeErr,
                    'deleting newly created volume should not error');
                t.end();
            });
    });


    test('volume should eventually transition to state \'deleted\'',
        function (t) {
            var expectedState = 'deleted';

            mod_testVolumes.waitForTransitionToState(CLIENT, testVolume.uuid,
                expectedState, function onTransition() {
                    CLIENT.get('/my/volumes/' + testVolume.uuid,
                        function onGetVolume(getVolumeErr, req, res, volume) {
                            t.ifErr(getVolumeErr,
                                'getting newly created volume should not ' +
                                    'error');
                            t.ok(typeof (volume) === 'object' &&
                                volume !== null,
                                    'response should be a non-null object');
                            t.equal(volume.name, testVolumeName,
                                'volume name should be \'' + testVolumeName +
                                    '\'');
                            t.equal(volume.state, expectedState,
                                'volume should have transitioned to state \'' +
                                    expectedState + '\'');

                            t.end();
                    });
            });
    });

    test('teardown', function (t) {
        common.teardown(CLIENTS, SERVER, function () {
            t.end();
        });
    });
}