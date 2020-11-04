/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var test = require('@smaller/tap').test;
var vasync = require('vasync');

var common = require('./common');
var mod_config = require('../lib/config.js');
var mod_testConfig = require('./lib/config');
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

    var createdVolumes = [];
    var testVolume;
    /* eslint-disable no-inner-declarations */
    function onVolumeCreatedCreator(t) {
        return function onVolumeCreated(volumeCreationErr, req, res, volume) {
            if (!volumeCreationErr && volume) {
                createdVolumes.push(volume);
                testVolume = volume;
            }

            t.ifErr(volumeCreationErr,
                'creating a volume with no name should succeed');
            t.ok(testVolume, 'should have set testVolume');
            if (testVolume) {
                t.ok((testVolume.name.length > 1),
                    'returned volume should have a name, got: '
                    + JSON.stringify(testVolume.name));
            }

            t.end();
        };
    }

    function volumeReadyWaiter(t) {
        var expectedState = 'ready';

        if (!testVolume) {
            t.fail('no volume to wait on when we expected one');
            t.end();
            return;
        }

        mod_testVolumes.waitForTransitionToState(CLIENT, testVolume.id,
            expectedState, function onTransition() {
                CLIENT.get('/my/volumes/' + testVolume.id,
                    function onGetVolume(getVolumeErr, req, res, volume) {
                        t.ifErr(getVolumeErr,
                            'getting newly created volume should succeed');
                        t.ok(volume, 'response should not be empty');

                        if (volume) {
                            t.equal(volume.state, expectedState,
                                'volume should have transitioned to state \'' +
                                expectedState + '\'');
                        }

                        t.end();
                    });
        });
    }
    /* eslint-enable no-inner-declarations */

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

    // first create with no name field passed at all

    test('creating volume with no name',
        function (t) {
            CLIENT.post('/my/volumes', {
                type: 'tritonnfs'
            }, onVolumeCreatedCreator(t));
    });

    test('volume should eventually transition to state \'ready\'',
        function (t) {
            volumeReadyWaiter(t);
    });

    test('deleting volumes should be successful', function (t) {
        vasync.forEachParallel({
            func: function deleteVolume(volume, done) {
                CLIENT.del('/my/volumes/' + volume.id,
                    function onDelVolume(delVolumeErr) {
                        t.ifErr(delVolumeErr,
                            'deleting volume ' + volume.name
                            + ' should succeed');
                        done();
                    });
            },
            inputs: createdVolumes
        }, function deleteDone() {
            t.end();
        });
    });

    test('creating volumes with invalid names', function (t) {
        /*
         * 'x'.repeat(257) generates a volume name that is one character too
         * long, as the max length for volume names is 256 characters.
         */
        var INVALID_NAMES = ['', '-foo', '.foo', 'x'.repeat(257)];
        vasync.forEachParallel({
            func: function createVolume(volumeName, done) {
                CLIENT.post('/my/volumes', {
                    type: 'tritonnfs',
                    name: volumeName
                }, function onVolCreated(volCreatErr) {
                    t.ok(volCreatErr, 'creating volume with name ' +
                        volumeName + ' should error, got: ' + volCreatErr);
                    done();
                });
            },
            inputs: INVALID_NAMES
        }, function invalidVolsCreated(_) {
            t.end();
        });
    });

    test('teardown', function (t) {
        common.teardown(CLIENTS, SERVER, function () {
            t.end();
        });
    });
}
