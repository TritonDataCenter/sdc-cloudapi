
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
const vasync = require('vasync');
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

function makeHttpClient(client) {
    const httpClient = restify.createHttpClient({
        url: client.url.href,
        version: client.headers['accept-version'],
        retryOptions: {
            retry: 0
        },
        log: client.log.child({
            component: 'changefeed',
            level: 'trace'
        }),
        rejectUnauthorized: false,
        signRequest: client.signRequest
    });
    httpClient.keyId = client.keyId;
    httpClient.privateKey = client.privateKey;
    httpClient.publicKey = client.publicKey;
    return httpClient;
}

test('Changefeed test', function (suite) {
    const context = {};
    vasync.pipeline({arg: context, funcs: [
        function setup(ctx, next) {
            common.setup({
                clientApiVersion: '~9'
            }, function (_, clients, server) {
                ctx.clients = clients;
                ctx.client = clients.user;
                ctx.other = clients.other;
                ctx.server = server;
                ctx.httpClient = makeHttpClient(ctx.client);
                ctx.httpClientOther = makeHttpClient(ctx.other);
                next();
            });
        },
        function getImage(ctx, next) {
            common.getTestImage(ctx.client, function (err, img) {
                suite.ifError(err, 'getTestImage');
                if (err) {
                    suite.fail('Test image not available');
                    suite.end();
                    next(err);
                    return;
                }
                suite.ok(img.id, 'img.id: ' + img.id);
                ctx.image_uuid = img.id;
                next();
            });
        },
        function createFirstMachine(ctx, next) {
            machinesCommon.createMachine(suite, ctx.client, {
                image: ctx.image_uuid,
                package: SDC_128.name,
                name: 'a' + uuid().substr(0, 7),
                firewall_enabled: true
            }, function (_err, machineUuid) {
                ctx.machine_uuid = machineUuid;
                machinesCommon.waitForRunningMachine(
                    ctx.client, ctx.machine_uuid, function (waitErr) {
                    suite.ifError(waitErr);
                    if (waitErr) {
                        // Skip machine tests when machine creation fails
                        ctx.machine_uuid = false;
                        suite.fail('Error waiting for running machine');
                        suite.end();
                        next(waitErr);
                        return;
                    }
                    next();
                });
            });
        },
        function createWsClient(ctx, next) {
            const shed = new Watershed();
            const wskey = shed.generateKey();
            ctx.httpClient.get({
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
                    const subRes = [
                        'alias',
                        'customer_metadata',
                        'destroyed',
                        'nics',
                        'owner_uuid',
                        'server_uuid',
                        'state',
                        'tags'
                    ];
                    ctx.wsc = shed.connect(res, socket, head, wskey);
                    ctx.wsc.on('error', (wsErr) => {
                        suite.ifError(wsErr, 'err');
                    });
                    ctx.wsc.on('end', () => {
                        console.log('WSC Closed');
                    });
                    ctx.wsc.on('text', (msg) => {
                        try {
                            const change = JSON.parse(msg);
                            // We don't care if it's not our machine:
                            if (change.changedResourceId !==
                                ctx.machine_uuid) {
                                suite.fail(
                                    'Unexpected message from unsubscribed VM');
                                return;
                            }
                            suite.ok(change.changeKind, 'changeKind');
                            suite.equal(change.changeKind.resource,
                                'vm', 'Change resource must be "vm"');
                            suite.ok(change.changeKind.subResources,
                                'subResources');
                            suite.ok(change.changedResourceId,
                                'changedResourceId');
                            suite.ok(change.published, 'published');

                            if (change.resourceObject) {
                                suite.equal(change.changedResourceId,
                                    change.resourceObject.id);
                            } else {
                                // We will not get any messages if
                                // resourceObject is not present:
                                return;
                            }

                            suite.ok(Array.isArray(
                                change.changeKind.subResources),
                                'Subresources is an array');

                            if (change.resourceState) {
                                suite.ok([
                                    'running',
                                    'shutting_down',
                                    'down',
                                    'ready'
                                ].indexOf(change.resourceState) !== -1,
                                    'Expected machine state');
                            }
                        } catch (e) {
                            suite.ifError(e);
                            return;
                        }
                    });

                    ctx.wsc.send(JSON.stringify({
                        resource: 'vm',
                        subResources: subRes,
                        vms: [ctx.machine_uuid]
                    }));
                });
                next();
            });
        },
        function createWsClientOther(ctx, next) {
            const shed = new Watershed();
            const wskey = shed.generateKey();
            ctx.httpClientOther.get({
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
                    const subRes = [
                        'alias',
                        'customer_metadata',
                        'destroyed',
                        'nics',
                        'owner_uuid',
                        'server_uuid',
                        'state',
                        'tags'
                    ];
                    ctx.wscOther = shed.connect(res, socket, head, wskey);
                    ctx.wscOther.on('error', (wsErr) => {
                        suite.ifError(wsErr, 'err');
                    });
                    ctx.wscOther.on('end', () => {
                        console.log('WSC Other Closed');
                    });
                    ctx.wscOther.on('text', (msg) => {
                        try {
                            const change = JSON.parse(msg);
                            // Other client should have no messages at all:
                            if (change.changedResourceId ===
                                ctx.machine_uuid) {
                                suite.fail('Accounts should not get Other VMs');
                            }
                        } catch (e) {
                            suite.ifError(e);
                            return;
                        }
                    });

                    ctx.wscOther.send(JSON.stringify({
                        resource: 'vm',
                        subResources: subRes
                    }));
                });
                next();
            });
        },
        // We should not get events from this VM, since we're explicitly
        // subscribed to the first one.
        function createSecondMachine(ctx, next) {
            machinesCommon.createMachine(suite, ctx.client, {
                image: ctx.image_uuid,
                package: SDC_128.name,
                name: 'a' + uuid().substr(0, 7),
                firewall_enabled: true
            }, function (_err, machineUuid) {
                ctx._2nd_machine_uuid = machineUuid;
                machinesCommon.waitForRunningMachine(
                    ctx.client, ctx._2nd_machine_uuid, function (waitErr) {
                    suite.ifError(waitErr);
                    if (waitErr) {
                        // Skip machine tests when machine creation fails
                        ctx._2nd_machine_uuid = false;
                        suite.fail('Error waiting for running machine');
                        suite.end();
                        next(waitErr);
                        return;
                    }
                    next();
                });
            });
        }
    ]}, function pipeCb(pipeErr) {
        suite.ifError(pipeErr);

        suite.test('Rename machine tests', function (t) {
            const renameTest = require('./machines/rename');
            renameTest(t, context.client, context.other,
                context.machine_uuid, () => {
                    t.end();
                });
        });

        suite.test('Reboot test', function (t) {
            const rebootTest = require('./machines/reboot');
            rebootTest(t, context.client, context.other,
                context.machine_uuid, () => {
                    t.end();
                });
        });

        suite.test('Delete tests', function (t) {
            const deleteTest = require('./machines/delete');
            deleteTest(t, context.client, context.other,
                context.machine_uuid, () => {
                    t.end();
                });
        });

        suite.test('Delete 2nd machine tests', function (t) {
            const deleteTest = require('./machines/delete');
            deleteTest(t, context.client, context.other,
                context._2nd_machine_uuid, () => {
                    t.end();
                });
        });

        suite.test('teardown', function (t) {
            context.httpClient.close();
            context.httpClientOther.close();
            common.teardown(context.clients, context.server, (teardownErr) => {
                t.ifError(teardownErr, 'teardown success');
                context.wsc.end();
                context.wscOther.end();
                t.end();
            });
        });
    });
});
