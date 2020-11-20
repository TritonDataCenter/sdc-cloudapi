
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */


const util = require('util');
const restify = require('restify');
const test = require('tape');
const Watershed = require('watershed').Watershed;

const common = require('./common');
const uuid = common.uuid;
const machinesCommon = require('./machines/common');
const mod_config = require('../lib/config.js');

// --- Globals

const SDC_128 = common.sdc_128_package;
const CONFIG = mod_config.configure();

// --- Tests


if (CONFIG.experimental_cloudapi_changefeed !== true) {
    console.log('experimental_cloudapi_changefeed setting not ' +
        'enabled, skipping tests');
    process.exit(0);
}

test('Changefeed test', function (suite) {
    common.setup({
        clientApiVersion: '~9.0'
    }, function (_, clients, server) {
        const CLIENTS = clients;
        const CLIENT = clients.user;
        const OTHER = clients.other;
        const SERVER = server;
        const shed = new Watershed();


        const httpClient = restify.createHttpClient({
            url: CLIENT.url.href,
            version: CLIENT.headers['accept-version'],
            retryOptions: {
                retry: 0
            },
            log: CLIENT.log,
            rejectUnauthorized: false,
            signRequest: CLIENT.signRequest
        });
        httpClient.keyId = CLIENT.keyId;
        httpClient.privateKey = CLIENT.privateKey;
        httpClient.publicKey = CLIENT.publicKey;

        let MACHINE_UUID;

        common.getTestImage(CLIENT, function (err, img) {
            suite.ifError(err, 'getTestImage');
            suite.ok(img.id, 'img.id: ' + img.id);
            const IMAGE_UUID = img.id;

            machinesCommon.createMachine(suite, CLIENT, {
                image: IMAGE_UUID,
                package: SDC_128.name,
                name: 'a' + uuid().substr(0, 7),
                firewall_enabled: true
            }, function (_err, machineUuid) {
                MACHINE_UUID = machineUuid;
                machinesCommon.waitForRunningMachine(
                    CLIENT, MACHINE_UUID, function (waitErr) {
                    suite.ifError(waitErr);
                    if (waitErr) {
                        // Skip machine tests when machine creation fails
                        MACHINE_UUID = false;
                        suite.end();
                        return;
                    }
                    console.log(util.inspect(MACHINE_UUID, false, 8, true));
                    httpClient.get({
                        headers: {
                            connection: 'upgrade',
                            upgrade: 'websocket',
                            'sec-websocket-key': shed.generateKey()
                        },
                        path: '/my/changefeed'
                    }, (feedErr, res, body) => {
                        console.log(util.inspect(feedErr, false, 8, true));
                        console.log(util.inspect(res, false, 1, true));
                        console.log(util.inspect(body, false, 8, true));

                        httpClient.close();
                        common.teardown(CLIENTS, SERVER, (teardownErr) => {
                            suite.ifError(teardownErr, 'teardown success');
                            suite.end();
                        });
                    });
                    return;
/*
                    suite.test('Rename machine tests', function (t) {
                        const renameTest = require('./machines/rename');
                        renameTest(t, CLIENT, OTHER, MACHINE_UUID, () => {
                            t.end();
                        });
                    });

                    suite.test('Stop test', function (t) {
                        const stopTest = require('./machines/stop');
                        stopTest(t, CLIENT, OTHER, MACHINE_UUID, () => {
                            t.end();
                        });
                    });

                    suite.test('Start test', function (t) {
                        const startTest = require('./machines/start');
                        startTest(t, CLIENT, OTHER, MACHINE_UUID, () => {
                            t.end();
                        });
                    });

                    suite.test('Reboot test', function (t) {
                        const rebootTest = require('./machines/reboot');
                        rebootTest(t, CLIENT, OTHER, MACHINE_UUID, () => {
                            t.end();
                        });
                    });

                    suite.test('Delete tests', function (t) {
                        const deleteTest = require('./machines/delete');
                        deleteTest(t, CLIENT, OTHER, MACHINE_UUID, () => {
                            t.end();
                        });
                    });

                    suite.test('teardown', function (t) {
                        httpClient.close();
                        common.teardown(CLIENTS, SERVER, (teardownErr) => {
                            t.ifError(teardownErr, 'teardown success');
                            t.end();
                        });
                    });
*/
                    suite.end();
                });
            });
        });
    });
});
