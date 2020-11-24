/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * Exposes the internal change feed
 */

const EventEmitter = require('events');
const util = require('util');

const assert = require('assert-plus');
const changefeed = require('changefeed');
const { v4: uuidv4 } = require('uuid');
const Watershed = require('watershed').Watershed;

const shed = new Watershed();

const translate = require('./machines.js').translate;

// Error Handling Functions
function invalidSubResource(subResource, resource) {
    if (Array.isArray(subResource)) {
        return util.format(
            '%s are not valid changefeed subResources for the %s resource',
            subResource.join(', '), resource);
    } else {
        return util.format(
            '%s is not a valid changefeed subResource for the %s resource',
            subResource, resource);
    }
}

function invalidResource(resource) {
    return resource + ' is not a valid changefeed resource';
}

const VALID_CHANGES = {
    vm: [
        'alias',
        'customer_metadata',
        'destroyed',
        'nics',
        'owner_uuid',
        'server_uuid',
        'state',
        'tags'
    ],
    nic: [
        'create',
        'delete',
        'allow_dhcp_spoofing',
        'allow_ip_spoofing',
        'allow_mac_spoofing',
        'primary',
        'state'
    ],
    network: [
        'create',
        'delete',
        'gateway',
        'resolvers',
        'routes'
    ]
};

function assertChangeKind(changeKind, callback) {
    assert.object(changeKind, 'changeKind');
    assert.string(changeKind.resource, 'changeKind.resource');
    assert.array(changeKind.subResources, 'changeKind.subResources');

    const resource = Object.keys(VALID_CHANGES).find((elm) => {
        return (elm === changeKind.resource);
    });

    if (!resource) {
        callback(invalidResource(changeKind.resource));
        return;
    }

    const invalidSubRes = changeKind.subResources.filter((subResource) => {
        return (VALID_CHANGES[resource].indexOf(subResource) === -1);
    });

    if (invalidSubRes.length) {
        callback(invalidSubResource(invalidSubRes, changeKind.resource));
        return;
    }

    callback(null);
}

class Feed extends EventEmitter {
    constructor() {
        super();
        this.wss = {};
    }

    handler(req, res, next) {
        // Start streaming in events from VMAPI
        this.vmapiFeed = changefeed.createListener({
            backoff: {
                maxTimeout: Infinity,
                minTimeout: 10,
                retries: Infinity
            },
            log: req.log.child({
                component: 'changefeed',
                // Otherwise you'll see a ton of noise from here
                level: 'fatal'
            }),
            url: req.config.vmapi.url,
            instance: req.config.instanceUuid,
            service: req.config.serviceName,
            changeKind: {
                resource: 'vm',
                subResources: VALID_CHANGES.vm
            }
        });

        this.vmapiFeed.register();
        this.vmapiFeed.on('bootstrap', () => {
            req.log.trace('Changefeed bootstrap complete');
        });

        this.vmapiFeed.on('readable', () => {
            const changeItem = this.vmapiFeed.read();
            this.emit('vm', changeItem);
        });

        this.vmapiFeed.on('error', (listenerErr) => {
            req.log.error({err: listenerErr}, 'LISTENER ERROR');
        });

        this.vmapiFeed.on('connection-end', () => {
            req.log.debug('Changefeed connection-end');
        });
        // Handle Incoming Upgrade Requests
        if (!res.claimUpgrade) {
            next(new Error('Connection Must Upgrade For WebSockets'));
            return;
        }

        const reqdom = process.domain;

        if (reqdom && reqdom.domain) {
            reqdom.exit();
        }

        const upgrade = res.claimUpgrade();
        const ws = shed.accept(req, upgrade.socket, upgrade.head);

        ws.once('text', (msg) => {
            let changeKind;
            // Parse the incoming response, and then validate it.
            try {
                changeKind = JSON.parse(msg);
            } catch (e) {
                req.log.error({
                    changeKind: changeKind,
                    err: e
                }, 'Invalid changeKind registration');
                ws.end('womp', e);
                return;
            }

            assertChangeKind(changeKind, function (err) {
                if (err !== null) {
                    ws.end(err);
                    return;
                }
            });

            const uuid = uuidv4();
            // Pop the websocket onto a object so we can clean it up later
            this.wss[uuid] = ws;

            const closeWsObj = () => {
                if (this.wss[uuid] !== undefined) {
                    this.wss[uuid].end();
                    delete this.wss[uuid];
                }
            };
            ws.on('end', closeWsObj);
            ws.on('connectionReset', closeWsObj);

            this.on(changeKind.resource, (changeItem) => {
                const chItemKind = changeItem.changeKind;
                const matches = chItemKind.subResources.filter((e1) => {
                    return changeKind.subResources.some((e2) => {
                        return (e1 === e2);
                    });
                });

                if (matches.length > 0 &&
                    changeKind.resource === 'vm' &&
                    (changeItem.resourceObject &&
                    changeItem.resourceObject.owner_uuid ===
                    req.account.uuid)) {
                    const wsMsg = JSON.parse(JSON.stringify(changeItem));
                    wsMsg.resourceObject = translate(
                        wsMsg.resourceObject, req);
                    // translateState in translate in machines.js
                    // changes the down, and stopped states to stopped.
                    // if we don't override with the original we get
                    // false positives. Perhaps cloudapi's
                    // translateStates should match events produced.
                    wsMsg.resourceObject.state =
                        changeItem.resourceObject.state;
                    if (typeof (this.wss[uuid]) !== 'undefined') {
                        this.wss[uuid].send(JSON.stringify(wsMsg));
                    }
                }
            });
        });

        if (reqdom && reqdom.domain) {
            reqdom.enter();
        }
        res.statusCode = 101;
        next();
    }
}

function mount(server, before) {
    assert.object(server);

    const feed = new Feed();
    server.get({
        path: '/:account/changefeed',
        name: 'changefeed'
    },
    before,
    feed.handler.bind(feed));

    return server;
}
module.exports = {
    mount: mount
};
