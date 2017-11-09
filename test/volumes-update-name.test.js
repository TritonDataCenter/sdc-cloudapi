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

    var testVolumeName = 'test-volumes-basic';
    var testVolumeSecondName = 'test-volumes-basic-renamed';
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

    test('volume should eventually transition to state \'ready\'',
        function (t) {
            var expectedState = 'ready';

            mod_testVolumes.waitForTransitionToState(CLIENT, testVolume.id,
                expectedState, function onTransition() {
                    CLIENT.get('/my/volumes/' + testVolume.id,
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

    test('updating newly created volume\'s name should succeed', function (t) {
        CLIENT.post('/my/volumes/' + testVolume.id, {
            name: testVolumeSecondName
        }, function onVolumeRenamed(volUpdateErr) {
            t.ifErr(volUpdateErr, 'renaming volume ' + testVolumeName + ' to ' +
                testVolumeSecondName + ' should succeed');
            t.end();
        });
    });

    test('listing volumes should only include new name', function (t) {
        CLIENT.get('/my/volumes',
            function onVolumesListed(volGetErr, req, res, volumes) {
                t.ifErr(volGetErr, 'listing volumes should be succeed');
                t.ok(volumes, 'response should not be empty');
                t.ok(Array.isArray(volumes), 'response should be an array');
                t.equal(volumes.length, 1,
                    'response should include only one volume');
                t.equal(volumes[0].name, testVolumeSecondName,
                    'only volume\'s name should be ' + testVolumeSecondName);
                t.end();
            });
    });

    test('deleting volume should be successful', function (t) {
        CLIENT.del('/my/volumes/' + testVolume.id,
            function onDelVolume(delVolumeErr) {
                t.ifErr(delVolumeErr,
                    'deleting newly created volume should not error');
                t.end();
            });
    });

    test('volume should eventually disappear', function (t) {
        mod_testVolumes.waitForDeletion(CLIENT, testVolume.id,
            function onDeleted() {
                CLIENT.get('/my/volumes/' + testVolume.id,
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
