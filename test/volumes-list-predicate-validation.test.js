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

    test('listing volumes with malformed predicate fails', function (t) {
        var MALFORMED_PREDICATE = 'malformed-predicate';

        CLIENT.get('/my/volumes?predicate=' + MALFORMED_PREDICATE,
            function onVolumesListed(listVolsErr, req, res, volumes) {
                var expectedStatusCode = 409;
                var expectedRestCode = 'InvalidArgument';
                var expectedErrorMsg =
                    'Could not parse JSON predicate malformed-predicate';

                t.ok(listVolsErr,
                    'listing volumes with a malformed predicate should error');
                t.equal(listVolsErr.restCode, expectedRestCode,
                    'rest code should be ' + expectedRestCode);
                t.equal(listVolsErr.statusCode, expectedStatusCode,
                    'status code should be ' + expectedStatusCode);
                t.ok(listVolsErr.message.indexOf(expectedErrorMsg) !== -1,
                    'error message should include: ' + expectedErrorMsg +
                        ', was: ' + listVolsErr.message);

                t.end();
            });
    });

    test('listing volumes with null-valued predicate fails', function (t) {
        var INVALID_PRED = JSON.stringify({
            eq: ['invalid-pred', null]
        });

        CLIENT.get('/my/volumes?predicate=' + INVALID_PRED,
            function onVolumesListed(listVolsErr, req, res, volumes) {
                var expectedStatusCode = 409;
                var expectedRestCode = 'InvalidArgument';
                var expectedErrorMsg =
                    'predicate { eq: [ \'invalid-pred\', null ] }: field ' +
                        '\"invalid-pred\" is not a string, number, or boolean';

                t.ok(listVolsErr,
                    'listing volumes with a malformed predicate should error');
                t.equal(listVolsErr.restCode, expectedRestCode,
                    'rest code should be ' + expectedRestCode);
                t.equal(listVolsErr.statusCode, expectedStatusCode,
                    'status code should be ' + expectedStatusCode);
                t.ok(listVolsErr.message.indexOf(expectedErrorMsg) !== -1,
                    'error message should include: ' + expectedErrorMsg +
                        ', was: ' + listVolsErr.message);

                t.end();
            });
    });


    test('listing volumes with valid predicates succeeds', function (t) {
        var VALID_ID_PRED = JSON.stringify({
            eq: ['id', libuuid.create()]
        });

        var VALID_NAME_PRED = JSON.stringify({
            eq: ['name', 'foo']
        });

        var VALID_NETWORK_PRED = JSON.stringify({
            eq: ['network', libuuid.create()]
        });

        var VALID_PREDS;

        var VALID_SIZE_PRED = JSON.stringify({
            eq: ['size', 42]
        });

        var VALID_STATE_PRED = JSON.stringify({
            eq: ['state', 'deleting']
        });

        var VALID_TYPE_PRED = JSON.stringify({
            eq: ['type', 'tritonnfs']
        });

        VALID_PREDS = [
            VALID_ID_PRED,
            VALID_NAME_PRED,
            VALID_NETWORK_PRED,
            VALID_SIZE_PRED,
            VALID_STATE_PRED,
            VALID_TYPE_PRED
        ];

        vasync.forEachParallel({
            func: function testValidPred(validPred, done) {
                CLIENT.get('/my/volumes?predicate=' + validPred,
                    function onVolumesListed(listVolsErr, req, res, volumes) {
                        var expectedStatusCode = 200;

                        t.ok(!listVolsErr,
                            'listing volumes with a valid predicate should ' +
                                'not error, got: ' + listVolsErr);
                        t.equal(res.statusCode, expectedStatusCode,
                            'status code should be ' + expectedStatusCode);

                        done();
                    });
            },
            inputs: VALID_PREDS
        }, function allValidPredsTested(err) {
            t.end();
        });
    });

    test('listing volumes with invalid predicates fails', function (t) {
        var INVALID_ID_PRED = JSON.stringify({
            eq: ['id', 'invalid-id']
        });

        var INVALID_NAME_PRED = JSON.stringify({
            eq: ['name', '*;/-|']
        });

        var INVALID_NETWORK_PRED = JSON.stringify({
            eq: ['network', 'foo']
        });

        var INVALID_PREDS;

        var INVALID_SIZE_PRED = JSON.stringify({
            eq: ['size', 'bar']
        });

        var INVALID_STATE_PRED = JSON.stringify({
            eq: ['state', 'invalid-state']
        });

        var INVALID_TYPE_PRED = JSON.stringify({
            eq: ['type', 'invalid-type']
        });

        INVALID_PREDS = [
            INVALID_ID_PRED,
            INVALID_NAME_PRED,
            INVALID_NETWORK_PRED,
            INVALID_SIZE_PRED,
            INVALID_STATE_PRED,
            INVALID_TYPE_PRED
        ];

        vasync.forEachParallel({
            func: function testValidPred(invalidPred, done) {
                CLIENT.get('/my/volumes?predicate=' + invalidPred,
                    function onVolumesListed(listVolsErr, req, res, volumes) {
                        var expectedStatusCode = 409;

                        t.ok(listVolsErr,
                            'listing volumes with a invalid predicate should ' +
                                'error, got: ' + listVolsErr);
                        t.equal(res.statusCode, expectedStatusCode,
                            'status code should be ' + expectedStatusCode);

                        done();
                    });
            },
            inputs: INVALID_PREDS
        }, function allValidPredsTested(err) {
            t.end();
        });
    });

    test('teardown', function (t) {
        common.teardown(CLIENTS, SERVER, function () {
            t.end();
        });
    });
}