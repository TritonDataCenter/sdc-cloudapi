/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var libuuid = require('libuuid');
var test = require('tape').test;
var vasync = require('vasync');

var common = require('./common');
var mod_config = require('../lib/config.js');
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
            CLIENT  = clients.user;
            SERVER  = server;

            t.end();
        });
    });

    test('creating volume with invalid name fails', function (t) {
        var invalidVolumeName = '-invalid-volume-name';

        CLIENT.post('/my/volumes', {
            name: invalidVolumeName,
            type: 'tritonnfs'
        }, function onVolumeCreated(volumeCreationErr, req, res, volume) {
            var expectedStatusCode = 409;
            var expectedRestCode = 'InvalidArgument';
            var expectedErrorMsg = 'Invalid volume name: ' + invalidVolumeName;

            t.ok(volumeCreationErr,
                'creating a volume with an invalid name should error');
            t.equal(volumeCreationErr.restCode, expectedRestCode,
                'rest code should be ' + expectedRestCode);
            t.equal(volumeCreationErr.statusCode, expectedStatusCode,
                'status code should be ' + expectedStatusCode);
            t.ok(volumeCreationErr.message.indexOf(expectedErrorMsg) !== -1,
                'error message should include: ' + expectedErrorMsg);

            t.end();
        });
    });

    test('creating volume with invalid type fails', function (t) {
        var testVolumeName = 'test-volumes-basic-invalid-type';
        var invalidVolumeType = 'invalid-volume-type';

        CLIENT.post('/my/volumes', {
            name: testVolumeName,
            type: invalidVolumeType
        }, function onVolumeCreated(volumeCreationErr, req, res, volume) {
            var expectedStatusCode = 409;
            var expectedRestCode = 'InvalidArgument';
            var expectedErrorMsg = 'Invalid volume type: ' + invalidVolumeType;

            t.ok(volumeCreationErr,
                'creating a volume with an invalid type should error');
            t.equal(volumeCreationErr.restCode, expectedRestCode,
                'rest code should be ' + expectedRestCode);
            t.equal(volumeCreationErr.statusCode, expectedStatusCode,
                'status code should be ' + expectedStatusCode);
            t.ok(volumeCreationErr.message.indexOf(expectedErrorMsg) !== -1,
                'error message should include: ' + expectedErrorMsg);

            t.end();
        });
    });

    test('creating volume with invalid size fails', function (t) {
        var invalidVolumeSize = 'invalid-volume-size';
        var testVolumeName = 'test-volumes-basic-invalid-size';
        var testVolumeType = 'tritonnfs';

        CLIENT.post('/my/volumes', {
            name: testVolumeName,
            type: testVolumeType,
            size: invalidVolumeSize
        }, function onVolumeCreated(volumeCreationErr, req, res, volume) {
            var expectedStatusCode = 409;
            var expectedRestCode = 'InvalidArgument';
            var expectedErrorMsg = 'Invalid volume size: ' + invalidVolumeSize;

            t.ok(volumeCreationErr,
                'creating a volume with an invalid type should error');
            t.equal(volumeCreationErr.restCode, expectedRestCode,
                'rest code should be ' + expectedRestCode);
            t.equal(volumeCreationErr.statusCode, expectedStatusCode,
                'status code should be ' + expectedStatusCode);
            t.ok(volumeCreationErr.message.indexOf(expectedErrorMsg) !== -1,
                'error message should include: ' + expectedErrorMsg);

            t.end();
        });
    });

    test('creating volume with invalid network fails', function (t) {
        var invalidNetworksInputs = [
            'invalid-network',
            /*
             * Passing random UUIDs as network input parameters should fail, as
             * CloudAPI should check if they're valid fabric networks owner by
             * the test user.
             */
            libuuid.create(),
            [libuuid.create()],
            ['invalid-network'],
            {},
            42
        ];

        vasync.forEachParallel({
            func: function createVolWithInvalidNetworks(invalidNetworks, done) {
                var testVolumeName = 'test-volumes-basic-invalid-network';
                var testVolumeType = 'tritonnfs';

                CLIENT.post('/my/volumes', {
                    name: testVolumeName,
                    type: testVolumeType,
                    networks: invalidNetworks
                }, function onVolumeCreated(volCreationErr, req, res, volume) {
                    var expectedStatusCode = 409;
                    var expectedRestCode = 'InvalidArgument';
                    var expectedErrorMsg = 'Invalid networks: ' +
                        invalidNetworks;
                    var actualErrMsg;

                    if (volCreationErr) {
                        actualErrMsg = volCreationErr.message;
                    }

                    t.ok(volCreationErr,
                        'creating a volume with a network input parameter ' +
                            'of: ' + invalidNetworks + ' should error');
                    t.equal(volCreationErr.restCode, expectedRestCode,
                        'rest code should be ' + expectedRestCode);
                    t.equal(volCreationErr.statusCode, expectedStatusCode,
                        'status code should be ' + expectedStatusCode);
                    t.ok(actualErrMsg.indexOf(expectedErrorMsg) !== -1,
                        'error message should include: ' + expectedErrorMsg);

                    done();
                });
            },
            inputs: invalidNetworksInputs
        }, function onAllTestsDone() {
            t.end();
        });
    });

    test('teardown', function (t) {
        common.teardown(CLIENTS, SERVER, function () {
            t.end();
        });
    });
}