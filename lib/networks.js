/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert');
var util = require('util');
var restify = require('restify');

var resources = require('./resources');
var ResourceNotFoundError = restify.ResourceNotFoundError;

var EXTERNAL_NIC_TAG = 'external';
var INTERNAL_NIC_TAG = 'internal';
var ADMIN_NIC_TAG    = 'admin';


// Note here "net" can be either network or network_pool from NAPI
function translate(req, net) {
    assert.ok(req);
    assert.ok(net);

    var obj = {
        id: net.uuid,
        name: net.name
    };

    var isPublic;
    if (typeof (net['public']) !== 'undefined') {
        isPublic = net['public'];
    } else {
        isPublic = (net.nic_tag === EXTERNAL_NIC_TAG);
    }

    obj['public'] = isPublic;

    if (net.description) {
        obj.description = net.description;
    }

    return (obj);
}


// --- Functions
function load(req, res, next) {
    var pathname = req.getUrl().pathname;

    if (pathname === '/--ping') {
        return next();
    }

    assert.ok(req.account);
    assert.ok(req.sdc.napi);

    // Skip network loading and filtering if we're neither on networks
    // end-points or creating a machine
    if (!/\/networks/.test(pathname) && !(/\/machines$/.test(pathname) &&
        req.method.toUpperCase() === 'POST')) {
        return next();
    }

    return req.sdc.napi.listNetworkPools({
        provisionable_by: req.account.uuid
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, pools) {
        if (err) {
            return next(err);
        }

        // uuids of all publically-accessible networks accessible by user
        req.external_nets = [];

        // uuids of all internally-accessible networks accessible by user
        req.internal_nets = [];

        // objects of all networks accessible by user
        req.networks = [];

        var networksInPools = {};

        // Always skip admin network pools:
        pools = pools.filter(function (pool) {
            return (pool.nic_tag !== ADMIN_NIC_TAG);
        });

        pools.forEach(function (pool) {
            req.networks.push(pool);

            pool.networks.forEach(function (net) {
                networksInPools[net.uuid] = true;
            });

            if (pool.nic_tag === EXTERNAL_NIC_TAG) {
                req.external_nets.push(pool.uuid);
            } else if (pool.nic_tag === INTERNAL_NIC_TAG) {
                req.internal_nets.push(pool.uuid);
            }
        });

        return req.sdc.napi.listNetworks({
            provisionable_by: req.account.uuid
        }, {
            headers: {
                'x-request-id': req.getId()
            }
        }, function (err2, networks) {
            if (err2) {
                return next(err2);
            }

            // Always skip admin networks, and don't add networks which are
            // already in contained pools:
            networks = networks.filter(function (net) {
                return net.nic_tag !== ADMIN_NIC_TAG &&
                    !networksInPools[net.uuid];
            });

            req.networks = req.networks.concat(networks);

            networks.forEach(function (net) {
                if (net.nic_tag === EXTERNAL_NIC_TAG) {
                    req.external_nets.push(net.uuid);
                } else if (net.nic_tag === INTERNAL_NIC_TAG) {
                    req.internal_nets.push(net.uuid);
                }
            });

            req.log.debug({
                external: req.external_nets,
                internal: req.internal_nets
            }, 'networks loaded');

            return next();
        });
    });
}


function list(req, res, next) {
    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }

    var networks = req.networks;

    // req.networks includes both networks and pools. We don't want to list
    // individual networks if their pool in included.

    var skipNetworkUuids = [];
    networks.forEach(function (n) {
        // if it's a network pool...
        if (Array.isArray(n.networks)) {
            skipNetworkUuids = skipNetworkUuids.concat(n.networks);
        }
    });

    networks = networks.filter(function (n) {
        // assuming this list never gets too big
        return skipNetworkUuids.indexOf(n.uuid) === -1;
    }).map(function (pool) {
        return translate(req, pool);
    });

    req.log.debug({
        networks: networks,
        account: req.account.login
    }, 'ListNetworks done');

    res.send(networks);
    return next();
}


function get(req, res, next) {
    var _n = req.params.network;
    var net = req.networks.filter(function (n) {
        return (n.uuid === _n);
    });
    var network;

    if (!net.length) {
        return next(new ResourceNotFoundError('%s not found', _n));
    }

    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }

    network = translate(req, net[0]);

    req.log.debug({
        network: network,
        account: req.account.login
    }, 'GetNetwork');

    res.send(network);
    return next();
}



function mount(server, before) {
    assert.argument(server, 'object', server);

    server.get({
        path: '/:account/networks',
        name: 'ListNetworks'
    }, before || list, before ? list : undefined);

    server.head({
        path: '/:account/networks',
        name: 'HeadNetworks'
    }, before || list, before ? list : undefined);

    server.get({
        path: '/:account/networks/:network',
        name: 'GetNetwork'
    }, before || get, before ? get : undefined);

    server.head({
        path: '/:account/networks/:network',
        name: 'HeadNetwork'
    }, before || get, before ? get : undefined);

    return server;
}


// --- API

module.exports = {
    load: load,
    mount: mount
};
