/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 * Copyright 2020 Bruce Smith.
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
    }

    handler(req, res, next) {
        this.latestMsgTimestamp = null;
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

        const cfDrain = () => {
            let changeItem;
            while ((changeItem = this.vmapiFeed.read()) !== null) {
                // Workaround for duplicated messages received:
                if (this.latestMsgTimestamp === changeItem.published) {
                    return;
                }
                this.latestMsgTimestamp = changeItem.published;
                processChange(changeItem);
            }
        };

        this.vmapiFeed.on('readable', cfDrain);

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

        const closeWsObj = () => {
            if (ws !== undefined) {
                ws.end();
            }
        };

        ws.on('connectionReset', closeWsObj);

        function processChange(changeItem) {
            const rObj = changeItem.resourceObject;
            if (rObj && rObj.owner_uuid === req.account.uuid) {
                const wsMsg = Object.assign({}, changeItem);
                wsMsg.resourceObject = translate(
                    wsMsg.resourceObject, req);
                // translateState in translate in machines.js
                // changes the down, and stopped states to stopped.
                // if we don't override with the original we get
                // false positives:
                if (changeItem.resourceObject.state === 'down') {
                    wsMsg.resourceObject.state =
                        changeItem.resourceObject.state;
                }
                ws.send(JSON.stringify(wsMsg));
            }
        }

        cfDrain();

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
