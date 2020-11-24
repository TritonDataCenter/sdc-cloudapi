
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */


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
            log: CLIENT.log.child({
                component: 'changefeed',
                level: 'trace'
            }),
            rejectUnauthorized: false,
            signRequest: CLIENT.signRequest
        });
        httpClient.keyId = CLIENT.keyId;
        httpClient.privateKey = CLIENT.privateKey;
        httpClient.publicKey = CLIENT.publicKey;

        let MACHINE_UUID;

        common.getTestImage(CLIENT, function (err, img) {
            suite.ifError(err, 'getTestImage');
            if (err) {
                suite.fail('Test image not available');
                suite.end();
                return;
            }
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
                        suite.fail('Error waiting for running machine');
                        suite.end();
                        return;
                    }
                    const wskey = shed.generateKey();
                    let wsc;

                    httpClient.get({
                        headers: {
                            connection: 'upgrade',
                            upgrade: 'websocket',
                            'sec-websocket-key': wskey
                        },
                        path: '/my/changefeed'
                    }, (feedErr, req) => {
                        suite.ifError(feedErr);
                        req.on('result', (resErr, _result) => {
                            suite.ifError(resErr, 'resErr');
                        });
                        req.on('upgradeResult', (upErr, res, socket, head) => {
                            suite.ifError(upErr, 'upResErr');
                            socket.setNoDelay(true);
                            wsc = shed.connect(res, socket, head, wskey);
                            wsc.on('error', (wsErr) => {
                                suite.ifError(wsErr, 'err');
                            });
                            wsc.on('end', () => {
                                console.log('WSC Closed');
                                suite.end();
                            });
                            wsc.on('text', (msg) => {
                                try {
                                    const change = JSON.parse(msg);
                                    suite.ok(change.changeKind, 'changeKind');
                                    suite.equal(change.changeKind.resource,
                                        'vm', 'Change resource must be "vm"');
                                    suite.ok(change.changeKind.subResources,
                                        'subResources');
                                    suite.ok(change.changedResourceId,
                                        'changedResourceId');
                                    suite.ok(change.published, 'published');
                                    if (change.changeObject) {
                                        suite.equal(change.changedResourceId,
                                            change.changeObject.id);
                                    } else {
                                        // We will not get any messages if
                                        // changeObject is not present:
                                        return;
                                    }

                                    // We should receive messages for different
                                    // events: rename, stop, delete. We want to
                                    // check that we got those here:
                                    const subr = change.changeKind.subResources;
                                    suite.ok(subr.indexOf('alias') !== -1 ||
                                            subr.indexOf('state') !== -1 ||
                                            subr.indexOf('destroyed') !== -1,
                                        'Expected events');
                                } catch (e) {
                                    suite.ifError(e);
                                    return;
                                }
                            });

                            wsc.send(JSON.stringify({
                                resource: 'vm',
                                subResources: [
                                    'alias',
                                    'customer_metadata',
                                    'destroyed',
                                    'nics',
                                    'owner_uuid',
                                    'server_uuid',
                                    'state',
                                    'tags'
                                ]}));
                        });
                    });

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
                            wsc.end();
                            t.end();
                        });
                    });
                });
            });
        });
    });
});
