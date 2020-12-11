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

const assert = require('assert-plus');
const changefeed = require('changefeed');
const Watershed = require('watershed').Watershed;

const shed = new Watershed();

const translate = require('./machines.js').translate;

const FakeRequest = {
    params: {},
    getVersion: function () {
        return '9.14.0';
    }
};

const VM_SUB_RESOURCES = [
    'alias',
    'customer_metadata',
    'destroyed',
    'nics',
    'owner_uuid',
    'server_uuid',
    'state',
    'tags'
];

/* eslint-disable max-len */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* eslint-enable max-len */

/**
 * A wrapper for changefeed Listener attached to CloudAPI's server with the
 * ability to broadcast messages to all the websocket clients connected to
 * CloudAPI for a given account.
 *
 * Additionally, clients can choose to filter the messages by one or more
 * VM UUIDs, instead of receive messages for all the VMs associated with
 * the account used for the request.
 *
 */
class Feed extends EventEmitter {
    /**
     * Given the way Changefeed works, we want to have a single listener;
     * otherwise, the second listener would get the messages instead of
     * the previously registered one.
     *
     * This would also help preventing DOS issues if the creation of multiple
     * listeners were allowed.
     *
     * Additionally, we want to keep track of as many websocket clients as
     * needed. These clients may or may not belong to the same account or be
     * subscribed to the same changes, but all must be available to the single
     * feed instance.
     *
     * Therefore, only a single Feed instance should be created across the
     * multiple processes that run CloudAPI's server.
     *
     * HAProxy configuration has been set to redirect all the WebSockets
     * requests to the last CloudAPI server instance.
     *
     * @param {Object} opts.
     * @param {Object} opts.config CloudAPI config.
     * @param {Object} opts.log Bunyan instance.
     */
    constructor(opts) {
        assert.object(opts, 'opts');
        assert.object(opts.config, 'opts.config');
        assert.object(opts.log, 'opts.log');

        super();

        this.config = opts.config;
        this.log = opts.log;

        this.latestMsg = null;
        this.wsConnections = {};

        this.vmapiFeed = null;

        this.registered = false;
    }

    createFeedListener() {
        // Start streaming in events from VMAPI
        this.vmapiFeed = changefeed.createListener({
            backoff: {
                maxTimeout: Infinity,
                minTimeout: 10,
                retries: Infinity
            },
            log: this.log.child({
                component: 'changefeed',
                // Otherwise you'll see a ton of noise from here
                level: 'trace'
            }),
            url: this.config.vmapi.url,
            instance: this.config.instanceUuid,
            service: this.config.serviceName,
            changeKind: {
                resource: 'vm',
                subResources: VM_SUB_RESOURCES
            }
        });

        this.vmapiFeed.on('bootstrap', (bsinfo) => {
            this.log.info({
                bootstrap_info: bsinfo
            }, 'Changefeed bootstrap complete');
        });

        this.vmapiFeed.on('error', (listenerErr) => {
            this.log.error({err: listenerErr}, 'LISTENER ERROR');
        });

        this.vmapiFeed.on('connection-end', () => {
            const connsByAccount = Object.keys(this.wsConnections);
            connsByAccount.forEach((account) => {
                Object.keys(this.wsConnections[account]).forEach((reqId) => {
                    this.wsConnections[account][reqId].end();
                });
                delete this.wsConnections[account];
            });
            if (!connsByAccount.length) {
                this.vmapiFeed = null;
                this.registered = false;
            }
            this.log.info('Changefeed connection-end');
        });
    }

    register() {
        if (!this.vmapiFeed) {
            this.createFeedListener();
        }
        if (!this.registered) {
            this.vmapiFeed.register();
            this.registered = true;
        }
    }


    getUniqueMessages() {
        let changeItem;
        while ((changeItem = this.vmapiFeed.read()) !== null) {
            // Workaround for duplicated messages received:
            const msg = this.latestMsg;
            if (msg &&
                msg.published === changeItem.published &&
                msg.changedResourceId === changeItem.changedResourceId) {
                return;
            }

            this.latestMsg = changeItem;
            this.broadcastChange(changeItem);
        }
    }

    broadcastChange(changeItem) {
        const rObj = changeItem.resourceObject;
        // Only send this message to wsConnections associated with the
        // account of the resource:
        if (!this.wsConnections[rObj.owner_uuid]) {
            this.log.trace({
                change: changeItem
            }, 'Skipping change. No wsConns for this account uuid.');
            return;
        }
        const wsMsg = Object.assign({}, changeItem);
        wsMsg.resourceObject = translate(
                wsMsg.resourceObject, FakeRequest);
        // translateState in translate in machines.js
        // changes the down, and stopped states to stopped.
        // if we don't keep the original we get
        // false positives:
        wsMsg.resourceState = changeItem.resourceObject.state;

        Object.keys(this.wsConnections[rObj.owner_uuid]).forEach((reqId) => {
            const wsc = this.wsConnections[rObj.owner_uuid][reqId];
            const reg = wsc._registration;
            if (!reg) {
                this.log.trace({
                    change: changeItem,
                    reqId: reqId
                }, 'No registration yet for WebSockets connection.');
                return;
            }
            // First check if we are subscribed to any of the modified
            // subresources. Otherwise, do not send feed message:
            if (!Array.isArray(changeItem.changeKind.subResources) ||
                !changeItem.changeKind.subResources.some((sub) => {
                return (reg.subResources.indexOf(sub) !== -1);
            })) {
                this.log.trace({
                    change: changeItem,
                    registration: reg
                }, 'Subresources do not match registration');
                return;
            }
            // If registration has a filter on VMs, make sure our change
            // is related to one of those vms:
            if (reg.vms &&
                reg.vms.indexOf(changeItem.changedResourceId) === -1) {
                this.log.trace({
                    change: changeItem,
                    registration: reg
                }, 'Change VM do not match registration');
                return;
            }
            // If everything else is Ok, send the message:
            wsc.send(JSON.stringify(wsMsg));
        });
    }
}


const feedHandler = (req, res, next) => {
    this.latestMsgTimestamp = null;

    // This method call needs to happen within Request handler:
    req.feed.register();

    req.feed.vmapiFeed.on('readable',
        req.feed.getUniqueMessages.bind(req.feed));

    // Handle Incoming Upgrade Requests
    if (!res.claimUpgrade) {
        next(new Error('Connection Must Upgrade For WebSockets'));
        return;
    }

    /*
     * Since cloudapi still runs with restify request domains enabled, we
     * need to exit that domain here if we want any errors in the VNC FSM
     * to be reported sensibly (since the request will end from restify's
     * perspective once we send the 101).
     *
     * This can be removed once domains and the uncaughtException handler
     * are turned off for cloudapi.
     */
    const reqdom = process.domain;

    if (reqdom && reqdom.domain) {
        reqdom.exit();
    }

    const account_uuid = req.account.uuid;
    const reqId = req.getId();

    const upgrade = res.claimUpgrade();
    const ws = shed.accept(req, upgrade.socket, upgrade.head);

    const wscs = req.feed.wsConnections;

    if (!wscs[account_uuid]) {
        wscs[account_uuid] = {};
    }

    wscs[account_uuid][reqId] = ws;

    const closeWsObj = () => {
        if (ws !== undefined) {
            ws.end();
        }
        delete wscs[account_uuid][reqId];
        if (Object.keys(wscs[account_uuid]).length === 0) {
            delete wscs[account_uuid];
        }

        if (Object.keys(wscs).length === 0) {
            req.feed.vmapiFeed.close();
            delete req.feed.vmapiFeed;
            // vmapiFeed.wsc.end();
        }
    };

    ws.on('connectionReset', closeWsObj);

    // Try to parse the message, check if it is a valid changefeed
    // payload, and store with the ws connection.
    ws.on('text', (msg) => {
        try {
            msg = JSON.parse(msg);
            if (!msg.resource || msg.resource !== 'vm') {
                req.log.error({
                    error: new Error('Invalid changefeed resource'),
                    msg: msg.resource
                }, 'Invalid changefeed resource.');
                // Shall send a message with the error to the websocket?
                return;
            }
            // Validate msg.subResources:
            if (!msg.subResources || msg.subResources.some((sub) => {
                return VM_SUB_RESOURCES.indexOf(sub) === -1;
            })) {
                req.log.error({
                    error: new Error('Invalid changefeed subResources'),
                    msg: msg.subResources
                }, 'Invalid changefeed subResources.');
                return;
            }
            // Validate msg.vms if present:
            if (msg.vms && (!Array.isArray(msg.vms) ||
                msg.vms.some((vm) => { return (!UUID_RE.test(vm)); })
            )) {
                req.log.error({
                    error: new Error('Invalid changefeed vms filter'),
                    msg: msg.vms
                }, 'Invalid changefeed vms filter');
                return;
            }
            ws._registration = msg;
        } catch (e) {
            req.log.error({
                error: e
            }, 'Error trying to parse WebSockets message');
        }
    });

    if (reqdom && reqdom.domain) {
        reqdom.enter();
    }
    res.statusCode = 101;
    next();
};

const mount = (server, before) => {
    assert.object(server);
    server.get({
        path: '/:account/changefeed',
        name: 'changefeed'
    },
    before,
    feedHandler);

    return server;
};

module.exports = {
    mount: mount,
    Feed: Feed
};
