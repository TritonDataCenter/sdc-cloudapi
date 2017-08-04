/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var libuuid = require('libuuid');
var test = require('tape').test;
var querystring = require('querystring');
var vasync = require('vasync');

var common = require('./common');
var mod_config = require('../lib/config');
var mod_testVolumes = require('./lib/volumes');

var CONFIG = mod_config.configure();
var VOLUMES_NAMES_PREFIX = 'cloudapi-test-volumes-list-params';

function deleteAllTestVolumeObjects(t, client, callback) {
    assert.object(t, 't');
    assert.object(client, 'client');
    assert.func(callback, 'callback');

    var query = '/my/volumes?' + querystring.stringify({
        name: '*' + VOLUMES_NAMES_PREFIX + '*'
    });

    client.get(query, function onListVolumes(err, req, res, volumes) {
        if (err) {
            callback(err);
            return;
        }

        vasync.forEachParallel({
            func: function deleteTestVolumeObject(volumeUuid, cb) {
                client.del('/my/volumes/' + volumeUuid,
                    function onDeleted(delErr) {
                        t.ifError(delErr, 'should have succeeded to delete '
                            + 'volume ' + volumeUuid);
                        cb(delErr);
                    });
            },
            inputs: volumes.map(function getVolumeUuid(volume) {
                assert.object(volume, 'volume');
                return volume.id;
            })
        }, function allVolumesDeleted(deleteErr) {
            callback(deleteErr);
        });
    });
}

function createTestVolume(client, volumeParams, callback) {
    assert.object(client, 'client');
    assert.object(volumeParams, 'volumeParams');
    assert.func(callback, 'callback');

    client.post('/my/volumes', volumeParams,
        function onCreate(err, req, res, volume) {
            callback(err, volume);
        });
}

function waitTestVolume(client, volumeId, expectedState, callback) {
    assert.object(client, 'client');
    assert.uuid(volumeId, 'volumeId');
    assert.string(expectedState, 'expectedState');
    assert.func(callback, 'callback');

    mod_testVolumes.waitForTransitionToState(client, volumeId, expectedState,
        function onTransition() {
            client.get('/my/volumes/' + volumeId,
                function onGetVolume(getVolumeErr, req, res, gotVolume) {
                    callback(getVolumeErr, gotVolume);
                });
        });
}

if (CONFIG.experimental_cloudapi_nfs_shared_volumes !== true) {
    console.log('experimental_cloudapi_nfs_shared_volumes setting not ' +
        'enabled, skipping tests');
    process.exitCode = 0;
} else {
    var CLIENTS;
    var CLIENT;
    var SERVER;
    var snowflakeName0 = 'dummy-' + VOLUMES_NAMES_PREFIX + '-empty0-foo';
    var snowflakeName1 = VOLUMES_NAMES_PREFIX + '-empty1-foo';
    var snowflakeName2 = VOLUMES_NAMES_PREFIX + '-empty2-foo';

    test('setup', function (tt) {
        tt.test('common setup', function (t) {
            common.setup({clientApiVersion: '~8.0'},
                function (_, clients, server) {
                    CLIENTS = clients;
                    CLIENT  = clients.user;
                    SERVER  = server;

                    t.end();
                });
        });
    });

    test('listing nfs shared volumes with invalid query parameters',
        function (tt) {

        var badParameters = [
            [
                'unknown query parameter should be rejected',
                'unknown parameter',
                {gorilla: 'king kong'}
            ],
            [
                'wildcard should not be allowed in middle of name',
                'wildcard',
                {name: 'go*la'}
            ],
            [
                'invalid size should fail',
                'size',
                {size: 'yuge'}
            ],
            [
                'invalid state should fail',
                'state',
                {state: 'confusion'}
            ],
            [
                // owner_uuid can't be passed to cloudapi
                'owner_uuid should be rejected',
                'owner_uuid',
                {owner_uuid: libuuid.create()}
            ]
        ];
        var idx;

        function invalidShouldBeRejected(params) {
            var invalidWhat = params[1];
            var listArgs = params[2];
            var testName = params[0];

            tt.test(testName, function (t) {
                var query = '/my/volumes?' + querystring.stringify(listArgs);

                CLIENT.get(query,
                    function onListVolumes(err, req, res, obj) {
                        t.ok(err, 'listing volumes with invalid ' + invalidWhat
                            + ' should error');
                        t.equal(err.restCode, 'InvalidArgument',
                            'error should be InvalidArgument');
                        t.end();
                    });
            });
        }

        for (idx = 0; idx < badParameters.length; idx++) {
            invalidShouldBeRejected(badParameters[idx]);
        }

        tt.test('conflicting predicate and query param should fail',
            function (t) {
                var predicate = {
                    eq: ['name', 'mechagodzilla']
                };
                var query = '/my/volumes?' + querystring.stringify({
                    name: 'godzilla',
                    predicate: JSON.stringify(predicate)
                });

                CLIENT.get(query, function onListVolumes(err, req, res, obj) {
                    t.ok(err,
                        'listing volumes with invalid predicate should error');
                    t.equal(err.restCode, 'InvalidArgument',
                        'error should InvalidArgument');
                    t.end();
                });
            });
    });

    // copied from sdc-volapi test/integration/list-with-params.test.js
    function snowflakeName(strName) {
        switch (strName) {
            case 'snowflakeName0':
                return snowflakeName0;
            case 'snowflakeName1':
                return snowflakeName1;
            case 'snowflakeName2':
                return snowflakeName2;
            default:
                return 'unknown volume';
        }
    }

    // copied from sdc-volapi test/integration/list-with-params.test.js
    function shouldFind(t, volumes, expected, notExpected, expectedNumber) {
        var foundVolumes = [];
        var idx;

        t.ok(Array.isArray(volumes), 'response body should be an array');
        if (expectedNumber !== undefined) {
            t.equal(volumes.length, expectedNumber, expectedNumber +
                ' volume(s) should be included in the response body');
        }

        volumes.forEach(function checkVolume(vol) {
            switch (vol.name) {
                case snowflakeName0:
                    foundVolumes.push('snowflakeName0');
                    break;
                case snowflakeName1:
                    foundVolumes.push('snowflakeName1');
                    break;
                case snowflakeName2:
                    foundVolumes.push('snowflakeName2');
                    break;
                default:
                    foundVolumes.push('unknownName');
                    break;
            }
        });

        for (idx = 0; idx < expected.length; idx++) {
            t.ok(foundVolumes.indexOf(expected[idx]) !== -1,
                'should have found ' + snowflakeName(expected[idx]));
        }

        for (idx = 0; idx < notExpected.length; idx++) {
            t.ok(foundVolumes.indexOf(notExpected[idx]) === -1,
                'should not have found ' + snowflakeName(notExpected[idx]));
        }

        return (foundVolumes);
    }

    test('create some test volumes', function (tt) {
        var testVolumeObjects = [
            {
                name: snowflakeName0,
                size: 10240,
                type: 'tritonnfs'
            },
            {
                name: snowflakeName1,
                size: 102400,
                type: 'tritonnfs'
            },
            {
                name: snowflakeName2,
                size: 1024000,
                type: 'tritonnfs'
            }
        ];

        vasync.forEachPipeline({
            func: function createVolume(newVol, cb) {
                // Can't use tt.comment because our version of tape doesn't have
                // the fix for substack/tape#92 (See also PUBAPI-1418)
                tt.ok(true, 'creating volume ' + newVol.name);
                createTestVolume(CLIENT, newVol,
                    function onCreated(err, createVol) {
                        var expectedState = 'ready';

                        tt.ifErr(err, 'should have created volume '
                            + newVol.name);
                        tt.ok(createVol, 'should have volume response');
                        if (err) {
                            cb(err);
                            return;
                        }
                        if (!createVol) {
                            cb(new Error('invalid created volume in response'));
                            return;
                        }
                        tt.ok(createVol, 'volume should have an id, got: '
                            + createVol.id);

                        // We need to wait for the volume to go "ready" here
                        // because volumes cannot be deleted when the
                        // underlying VM does not yet have a server_uuid.

                        waitTestVolume(CLIENT, createVol.id, expectedState,
                            function onWait(waitErr, waitVol) {
                                tt.ifErr(waitErr, 'getting newly created '
                                    + 'volume should not error');
                                tt.ok((typeof (waitVol) === 'object' &&
                                    waitVol !== null),
                                    'response should be a non-null object');
                                tt.equal(waitVol.name, newVol.name,
                                    'volume name should be \''
                                    + newVol.name + '\'');
                                tt.equal(waitVol.state, expectedState,
                                    'volume should have transitioned to '
                                    + 'state \'' + expectedState + '\'');
                                cb();
                            });
                    });
            }, inputs: testVolumeObjects
        }, function pipelineComplete(err) {
            tt.ifErr(err, 'should have created all volumes without error');
            tt.end();
        });
    });

    // The tests here are mostly the same as those in sdc-volapi
    // test/integration/list-with-params.test.js

    test('listing with empty predicate returns all volumes', function (tt) {
        var predicate = {};
        var query = '/my/volumes?' + querystring.stringify({
            predicate: JSON.stringify(predicate)
        });

        CLIENT.get(query, function onListVolumes(err, req, res, volumes) {
            tt.ifErr(err,
                'listing volumes with empty predicate should succeed');
            if (volumes !== undefined) {
                shouldFind(tt, volumes, [
                    // expected to find
                    'snowflakeName0',
                    'snowflakeName1',
                    'snowflakeName2'
                ], [
                    // expected to not find
                    'unknownName'
                ], 3);
            } else {
                tt.ok(false, 'no volumes returned');
            }

            tt.end();
        });
    });

    test('list with exact name returns 1 volume', function (tt) {
        var query = '/my/volumes?' + querystring.stringify({
            name: snowflakeName1
        });

        CLIENT.get(query, function onListVolumes(err, req, res, volumes) {
            tt.ifErr(err, 'listing volumes with a name param should not '
                + 'error');
            if (volumes !== undefined) {
                tt.ok(Array.isArray(volumes),
                    'response body should be an array');
                tt.equal(volumes.length, 1,
                    'only one volume should be included in the response '
                    + 'body');
                tt.equal(volumes[0].name, snowflakeName1,
                    'the name of the volume returned in the response '
                    + 'should be: ' + snowflakeName1 + ', got: '
                    + volumes[0].name);
            } else {
                tt.ok(false, 'no volumes returned by listVolumes');
            }
            tt.end();
        });
    });

    test('list with state=ready returns 3 volumes', function (tt) {
        var query = '/my/volumes?' + querystring.stringify({
            state: 'ready'
        });

        CLIENT.get(query, function onListVolumes(err, req, res, volumes) {
            tt.ifErr(err, 'listing volumes with state=ready should '
                + 'not error');

            if (volumes !== undefined) {
                shouldFind(tt, volumes, [
                    // expected to find
                    'snowflakeName0',
                    'snowflakeName1',
                    'snowflakeName2'
                ], [
                    // expected to not find
                    'unknownName'
                ], 3);
            } else {
                tt.ok(false, 'no volumes returned from listVolumes');
            }

            tt.end();
        });
    });

    test('list with name=*-foo returns 3 volumes', function (tt) {
        var query = '/my/volumes?' + querystring.stringify({
            name: '*-foo'
        });

        CLIENT.get(query, function onListVolumes(err, req, res, volumes) {
            tt.ifErr(err, 'listing volumes with a wildcard name param should '
                + 'not error');

            if (volumes !== undefined) {
                shouldFind(tt, volumes, [
                    // expected to find
                    'snowflakeName0',
                    'snowflakeName1',
                    'snowflakeName2'
                ], [
                    // expected to not find
                    'unknownName'
                ], 3);
            } else {
                tt.ok(false, 'no volumes returned from listVolumes');
            }

            tt.end();
        });
    });

    test('list with name=' + VOLUMES_NAMES_PREFIX + '-* returns 2 volumes',
        function (tt) {
            var query = '/my/volumes?' + querystring.stringify({
                name: VOLUMES_NAMES_PREFIX + '-*'
            });
            CLIENT.get(query, function onListVolumes(err, req, res, volumes) {
                tt.ifErr(err, 'listing volumes with a prefix name param should '
                    + 'not error');

                if (volumes !== undefined) {
                    shouldFind(tt, volumes, [
                        // expected to find
                        'snowflakeName1',
                        'snowflakeName2'
                    ], [
                        // expected to not find
                        'snowflakeName0',
                        'unknownName'
                    ], 2);
                } else {
                    tt.ok(false, 'no volumes returned from listVolumes');
                }

                tt.end();
            });
        });

    test('list with type=tritonnfs returns volumes', function (tt) {
        var query = '/my/volumes?' + querystring.stringify({
            type: 'tritonnfs'
        });
        CLIENT.get(query, function onListVolumes(err, req, res, volumes) {
            tt.ifErr(err,
                'listing volumes with type=tritonnfs should not error');
            tt.ok(Array.isArray(volumes), 'response body should be an array');
            tt.ok(volumes.length >= 3, 'should have at least 3 volumes, found: '
                + volumes.length);

            tt.end();
        });
    });

    // NOTE: testing with both string and number here really doesn't do anything
    // since the number will be stringified. But the two tests use different
    // sizes and confirm that they get different results, so that's still
    // valuable.

    test('list with size=102400 (number) returns correct volume',
        function (tt) {

        var query = '/my/volumes?' + querystring.stringify({
            size: 102400
        });

        CLIENT.get(query, function onListVolumes(err, req, res, volumes) {
            tt.ifErr(err, 'listing volumes with size=102400 should not error');

            if (volumes !== undefined) {
                shouldFind(tt, volumes, [
                    // expected to find
                    'snowflakeName1'
                ], [
                    // expected to not find
                    'snowflakeName0',
                    'snowflakeName2'
                ]);
            } else {
                tt.ok(false, 'no volumes returned from listVolumes');
            }

            tt.end();
        });
    });

    test('list with size=1024000 (string) returns correct volume',
        function (tt) {

        var query = '/my/volumes?' + querystring.stringify({
            size: '1024000'
        });

        CLIENT.get(query, function onListVolumes(err, req, res, volumes) {
            tt.ifErr(err, 'listing volumes with size=1024000 should not error');

            if (volumes !== undefined) {
                shouldFind(tt, volumes, [
                    // expected to find
                    'snowflakeName2'
                ], [
                    // expected to not find
                    'snowflakeName0',
                    'snowflakeName1'
                ]);
            } else {
                tt.ok(false, 'no volumes returned from listVolumes');
            }

            tt.end();
        });
    });

    test('teardown', function (tt) {
        tt.test('delete volumes', function (t) {
            deleteAllTestVolumeObjects(t, CLIENT, function (err) {
                t.ifErr(err, 'should have succeeded in deleting volumes');
                t.end();
            });
        });

        tt.test('common teardown', function (t) {
            common.teardown(CLIENTS, SERVER, function () {
                t.end();
            });
        });
    });
}
