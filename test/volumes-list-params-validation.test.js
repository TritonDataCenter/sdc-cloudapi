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
var querystring = require('querystring');
var vasync = require('vasync');

var common = require('./common');
var mod_config = require('../lib/config.js');

var CONFIG = mod_config.configure();

if (CONFIG.experimental_nfs_shared_volumes !== true) {
    console.log('experimental_nfs_shared_volumes setting not enabled, ' +
        'skipping tests');
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

    test('teardown', function (t) {
        common.teardown(CLIENTS, SERVER, function () {
            t.end();
        });
    });
}
