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
var util = require('util');
var verror = require('verror');

var common = require('./common');
var mod_config = require('../lib/config.js');
var mod_testConfig = require('./lib/config');
var mod_testNetworks = require('./lib/networks');
var mod_testVolumes = require('./lib/volumes');

var CONFIG = mod_config.configure();

/*
 * This regular expression is not meant to match the general ISO 8601 format,
 * only the specific format outputted by new Date().toISOString().
 */
var ISO_DATE_STRING_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;

function checkVolumeNotFoundError(err) {
    var expectedErrorName = 'VolumeNotFoundError';
    var expectedStatusCode = 404;
    var expectedRestCode = 'VolumeNotFound';

    if (!err) {
        return false;
    }

    if (err.statusCode !== expectedStatusCode) {
        return false;
    }

    if (err.restCode !== expectedRestCode) {
        return false;
    }

    if (err.name !== expectedErrorName) {
        return false;
    }

    return true;
}

if (CONFIG.experimental_cloudapi_nfs_shared_volumes !== true) {
    console.log('experimental_cloudapi_nfs_shared_volumes setting not ' +
        'enabled, skipping tests');
    process.exitCode = 0;
} else {
    var CLIENTS;
    var CLIENT;
    var OTHER;
    var SERVER;

    var testVolumeName = 'test-volumes-basic';
    var testVolume;
    var testVolumeStorageVmUuid;

    test('setup', function (t) {
        common.setup({clientApiVersion: '~8.0'}, function (_, clients, server) {
            CLIENTS = clients;
            CLIENT = clients.user;
            OTHER = clients.other;
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
                t.equal(testVolume.vm_uuid, undefined,
                    'vm_uuid property should not be present in the response');
                t.ok(ISO_DATE_STRING_RE.test(testVolume.create_timestamp),
                    'create_timestamp field should match ' +
                        ISO_DATE_STRING_RE);

                t.end();
            });
    });

    test('listing volumes should include newly created volume', function (t) {
        CLIENT.get('/my/volumes',
            function onVolumesListed(volumesListErr, req, res, volumes) {
                var volumesWithNewlyCreatedVolumeName;
                var createTimestamp;

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
                t.equal(volumesWithNewlyCreatedVolumeName[0].vm_uuid, undefined,
                    'vm_uuid property should not be present in the response');

                createTimestamp =
                    volumesWithNewlyCreatedVolumeName[0].create_timestamp;
                t.ok(ISO_DATE_STRING_RE.test(createTimestamp),
                    'create_timestamp field should match ' +
                        ISO_DATE_STRING_RE);

                t.end();
            });
    });

    test('getting newly created volume should succeeded', function (t) {
        CLIENT.get('/my/volumes/' + testVolume.id,
            function onGetVolume(getVolumeErr, req, res, volume) {
                t.ifErr(getVolumeErr,
                    'getting newly created volume should not error');
                t.ok(typeof (volume) === 'object' && volume !== null,
                    'response should be a non-null object ');
                t.equal(volume.name, testVolumeName,
                    'volume name should be \'' + testVolumeName + '\'');
                t.equal(testVolume.vm_uuid, undefined,
                    'vm_uuid property should not be present in the response');
                t.ok(ISO_DATE_STRING_RE.test(testVolume.create_timestamp),
                    'create_timestamp field should match ' +
                        ISO_DATE_STRING_RE);

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

    test('getting volume from other account should fail', function (t) {
        OTHER.get('/my/volumes/' + testVolume.id,
            function onGetVol(getVolErr, req, res, volume) {
                t.equal(checkVolumeNotFoundError(getVolErr), true,
                    'expected VolumeNotFoundError, got: ' +
                        util.inspect(getVolErr));
                t.end();
            });
    });

    test('deleting volume from other account should fail', function (t) {
        OTHER.del('/my/volumes/' + testVolume.id,
            function onDelVol(delVolErr, req, res, volume) {
                t.equal(checkVolumeNotFoundError(delVolErr), true,
                    'expected VolumeNotFoundError, got: ' +
                        util.inspect(delVolErr));
                t.end();
            });
    });

    test('updating volume from other account should fail', function (t) {
        OTHER.post('/my/volumes/' + testVolume.id, {
            name: 'foo'
        }, function onUpdateVol(updateVolErr, req, res, volume) {
            t.equal(checkVolumeNotFoundError(updateVolErr), true,
                'expected VolumeNotFoundError, got: ' +
                    util.inspect(updateVolErr));
            t.end();
        });
    });

    test('getting volume directly through VOLAPI', function (t) {
        CLIENT.volapi.getVolume({
            uuid: testVolume.id
        }, function onGetVol(getVolErr, volume) {
            t.ifErr(getVolErr,
                'getting volume through VOLAPI should not error');
            t.ok(volume, 'a volume should be found');
            t.ok(volume.vm_uuid, 'volume should have a VM uuid, got ' +
                volume.vm_uuid);

            testVolumeStorageVmUuid = volume.vm_uuid;

            t.end();
        });
    });

    test('listing machines should NOT include volume\'s storage VM',
        function (t) {
            CLIENT.get('/my/machines',
                function onMachinesListed(machinesListErr, req, res, machines) {
                    var machinesWithStorageVmUuid;

                    t.ifErr(machinesListErr,
                        'listing machines should not error');

                    if (machines && machines.length > 0) {
                        machinesWithStorageVmUuid =
                            machines.filter(function hasStorageVmUuid(machine) {
                                return machine.id === testVolumeStorageVmUuid;
                            });

                        t.ok(machinesWithStorageVmUuid.length, 0,
                            'No machine should have uuid of a storage VM uuid');
                    } else {
                        t.ok(!machines || machines.length === 0,
                            'listing machines returned an empty list');
                    }

                    t.end();
                });
        });

    test('getting nfs volume\'s storage VM should error', function (t) {
        CLIENT.get('/my/machines/' + testVolumeStorageVmUuid,
            function onMachineGet(machineGetErr, req, res, machine) {
                var expectedErrCode = 'ResourceNotFound';

                t.ok(machineGetErr,
                    'getting storage VM machine should error');

                if (machineGetErr) {
                    t.equal(machineGetErr.restCode, expectedErrCode,
                        'error code should be: ' + expectedErrCode);
                }

                t.end();
            });
    });

    test('sending HEAD req for nfs volume\'s storage VM should error',
        function (t) {
            CLIENT.head('/my/machines/' + testVolumeStorageVmUuid,
                function onMachineHead(machineHeadErr, req, res, machine) {
                    var expectedStatusCode = 404;

                    t.ok(machineHeadErr,
                        'sending HEAD request for storage VM machine should ' +
                            'error');
                    t.equal(machineHeadErr.statusCode, expectedStatusCode,
                        'status code should be: ' + expectedStatusCode);

                    t.end();
                });
        });

    test('updating nfs volume\'s storage VM should error', function (t) {
        CLIENT.post('/my/machines/' + testVolumeStorageVmUuid,
            function onMachineUpdate(machineUpdateErr, req, res, machine) {
                var expectedErrCode = 'ResourceNotFound';

                t.ok(machineUpdateErr,
                    'updating storage VM machine should error');
                t.equal(machineUpdateErr.restCode, expectedErrCode,
                    'error code should be: ' + expectedErrCode);

                t.end();
            });
    });

    test('deleting nfs volume\'s storage VM should error', function (t) {
        CLIENT.del('/my/machines/' + testVolumeStorageVmUuid,
            function onMachineDel(machineDelErr, req, res, machine) {
                var expectedErrCode = 'ResourceNotFound';

                t.ok(machineDelErr,
                    'deleting storage VM machine should error');
                t.equal(machineDelErr.restCode, expectedErrCode,
                    'error code should be: ' + expectedErrCode);

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

    // We created and deleted some VMs above. Without a predicate or a state
    // filter, we should not see any 'deleted' or 'failed' in a default query.
    test('/my/volumes should not include deleted or failed by default',
        function (t) {

            CLIENT.get('/my/volumes',
                function onGetVolumes(getVolumesErr, req, res, volumes) {
                    var idx;
                    var state;
                    var statesFound = {};

                    t.ifErr(getVolumesErr, 'getting volumes should succeed');
                    t.ok(typeof (volumes) === 'object' &&
                    volumes !== null,
                        'response should be a non-null object');

                    for (idx = 0; idx < volumes.length; idx++) {
                        state = volumes[idx].state;
                        if (!statesFound.hasOwnProperty(state)) {
                            statesFound[state] = 0;
                        }
                        statesFound[state]++;
                    }

                    t.equal(statesFound['failed'], undefined,
                        'results should include no failed volumes');
                    t.equal(statesFound['deleted'], undefined,
                        'results should include no deleted volumes');

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
