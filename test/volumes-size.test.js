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
    var DEFAULT_VOLUME_SIZE = 10 * units.MiBS_IN_GiB;
    var SERVER;
    var testVolumeDefaultSize, testVolume20MibsSize;
    var testVolumeNameDefaultSize = 'test-volumes-size-default';
    var testVolumeName20MibsSize = 'test-volumes-size-20';
    var VOLUME_SIZE_20_GiBs = 20 * units.MiBS_IN_GiB;

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

    test('creating volume with default size should create volume with size ' +
        'of ' + DEFAULT_VOLUME_SIZE + 'MiBs',
        function (t) {
            CLIENT.post('/my/volumes', {
                name: testVolumeNameDefaultSize,
                type: 'tritonnfs'
            }, function onVolumeCreated(volumeCreationErr, req, res, volume) {
                var expectedState = 'creating';
                var expectedType = 'tritonnfs';

                testVolumeDefaultSize = volume;

                t.ifErr(volumeCreationErr,
                    'creating a volume with default parameters should not ' +
                        'error');
                t.ok(testVolumeDefaultSize,
                    'returned volume should be an object');
                t.equal(testVolumeDefaultSize.type, 'tritonnfs',
                    'newly created volume should have type \'' + expectedType +
                        '\'');
                t.equal(testVolumeDefaultSize.state, 'creating',
                    'volume should have state \'' + expectedState + '\'');
                t.equal(testVolumeDefaultSize.size, DEFAULT_VOLUME_SIZE,
                    'volume size should be ' + DEFAULT_VOLUME_SIZE + ' MiBs');
                t.end();
            });
    });

    test('volume should eventually transition to state \'ready\'',
        function (t) {
            var expectedState = 'ready';

            testVolumes.waitForTransitionToState(CLIENT,
                testVolumeDefaultSize.id,
                expectedState, function onTransition() {
                    CLIENT.get('/my/volumes/' + testVolumeDefaultSize.id,
                        function onGetVolume(getVolumeErr, req, res, volume) {
                            t.ifErr(getVolumeErr,
                                'getting newly created volume should not ' +
                                    'error');
                            t.ok(typeof (volume) === 'object' &&
                                volume !== null,
                                    'response should be a non-null object');
                            t.equal(volume.name, testVolumeNameDefaultSize,
                                'volume name should be \'' +
                                    testVolumeNameDefaultSize + '\'');
                            t.equal(volume.state, expectedState,
                                'volume should have transitioned to state \'' +
                                    expectedState + '\'');

                            t.end();
                        });
            });
    });

    test('deleting volume should be successful', function (t) {
        CLIENT.del('/my/volumes/' + testVolumeDefaultSize.id,
            function onDelVolume(delVolumeErr) {
                t.ifErr(delVolumeErr,
                    'deleting newly created volume should not error');
                t.end();
            });
    });

    test('volume should eventually disappear', function (t) {
        testVolumes.waitForDeletion(CLIENT, testVolumeDefaultSize.id,
            function onDeleted() {
                CLIENT.get('/my/volumes/' + testVolumeDefaultSize.id,
                    function onGetVolume(getVolumeErr) {
                        t.ok(verror.hasCauseWithName(getVolumeErr,
                            'VolumeNotFoundError'), 'expected ' +
                            'VolumeNotFoundError error, got: ' +
                            (getVolumeErr ? getVolumeErr.name :
                            JSON.stringify(getVolumeErr)));

                        t.end();
                    });
            });
    });

    test('creating volume with size 20 GiBs should create volume with size ' +
        'of 20 GiBs',
        function (t) {
            CLIENT.post('/my/volumes', {
                name: testVolumeName20MibsSize,
                type: 'tritonnfs',
                size: VOLUME_SIZE_20_GiBs
            }, function onVolumeCreated(volumeCreationErr, req, res, volume) {
                var expectedState = 'creating';
                var expectedType = 'tritonnfs';

                testVolume20MibsSize = volume;

                t.ifErr(volumeCreationErr,
                    'creating a volume with default parameters should not ' +
                        'error');
                t.ok(testVolume20MibsSize,
                    'returned volume should be an object');
                t.equal(testVolume20MibsSize.type, 'tritonnfs',
                    'newly created volume should have type \'' + expectedType +
                        '\'');
                t.equal(testVolume20MibsSize.state, 'creating',
                    'volume should have state \'' + expectedState + '\'');
                t.equal(testVolume20MibsSize.size, VOLUME_SIZE_20_GiBs,
                    'volume size should be ' + VOLUME_SIZE_20_GiBs + ' MiBs');
                t.end();
            });
    });

    test('volume should eventually transition to state \'ready\'',
        function (t) {
            var expectedState = 'ready';

            testVolumes.waitForTransitionToState(CLIENT,
                testVolumeDefaultSize.id,
                expectedState, function onTransition() {
                    CLIENT.get('/my/volumes/' + testVolume20MibsSize.id,
                        function onGetVolume(getVolumeErr, req, res, volume) {
                            t.ifErr(getVolumeErr,
                                'getting newly created volume should not ' +
                                    'error');
                            t.ok(typeof (volume) === 'object' &&
                                volume !== null,
                                    'response should be a non-null object');
                            t.equal(volume.name, testVolumeName20MibsSize,
                                'volume name should be \'' +
                                    testVolumeName20MibsSize + '\'');
                            t.equal(volume.state, expectedState,
                                'volume should have transitioned to state \'' +
                                    expectedState + '\'');

                            t.end();
                        });
            });
    });

    test('deleting volume should be successful', function (t) {
        CLIENT.del('/my/volumes/' + testVolume20MibsSize.id,
            function onDelVolume(delVolumeErr) {
                t.ifErr(delVolumeErr,
                    'deleting newly created volume should not error');
                t.end();
            });
    });

    test('volume should eventually disappear', function (t) {
        testVolumes.waitForDeletion(CLIENT, testVolume20MibsSize.id,
            function onDeleted() {
                CLIENT.get('/my/volumes/' + testVolume20MibsSize.id,
                    function onGetVolume(getVolumeErr) {
                        t.ok(verror.hasCauseWithName(getVolumeErr,
                            'VolumeNotFoundError'), 'expected ' +
                            'VolumeNotFoundError error, got: ' +
                            (getVolumeErr ? getVolumeErr.name :
                            JSON.stringify(getVolumeErr)));

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
