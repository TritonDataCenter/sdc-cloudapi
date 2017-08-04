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
    var testVolumeStorageVmUuid;

    function onVolumeCreatedCreator(t) {
        return function onVolumeCreated(volumeCreationErr, req, res, volume) {
            if (!volumeCreationErr && volume) {
                createdVolumes.push(volume);
                testVolume = volume;
            }

            t.ifErr(volumeCreationErr,
                'creating a volume with no name should succeed');
            t.ok(testVolume, 'should have set testVolume');
            t.ok((testVolume.name.length > 1),
                'returned volume should have a name, got: '
                + JSON.stringify(testVolume.name));

            t.end();
        };
    }

    function volumeReadyWaiter(t) {
        var expectedState = 'ready';

        mod_testVolumes.waitForTransitionToState(CLIENT, testVolume.id,
            expectedState, function onTransition() {
                CLIENT.get('/my/volumes/' + testVolume.id,
                    function onGetVolume(getVolumeErr, req, res, volume) {
                        t.ifErr(getVolumeErr,
                            'getting newly created volume should succeed');
                        t.equal(volume.state, expectedState,
                            'volume should have transitioned to state \'' +
                                expectedState + '\'');

                        t.end();
                    });
        });
    }


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

    // second, create with empty string for a name (results should be same)

    test('creating volume with no name',
        function (t) {
            CLIENT.post('/my/volumes', {
                name: '',
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
        }, function deleteDone(err) {
            t.end();
        });
    });

    test('teardown', function (t) {
        common.teardown(CLIENTS, SERVER, function () {
            t.end();
        });
    });
}
