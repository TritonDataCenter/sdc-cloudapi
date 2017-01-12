/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');


var modNetworks = require('../networks');


function loadNetworks(req, res, next) {
    var method = req.method.toUpperCase();
    var pathname = req.getUrl().pathname;

    var napi = req.sdc.napi;
    assert.ok(napi);

    if (pathname === '/--ping') {
        return next();
    }

    assert.ok(req.account);
    var accountUuid = req.account.uuid;
    assert.ok(accountUuid);

    var netFilterOpts = {
        provisionable_by: accountUuid
    };

    if (req.query && req.query.fabric) {
        netFilterOpts = {
            fabric: true,
            owner_uuid: accountUuid
        };
    }


    // Skip network loading and filtering except for a few cases:
    // network endpoints
    if (!/\/networks/.test(pathname) &&
        // machine creation or nic addition (some AddNic plugins use this)
        !(method === 'POST' && /\/(?:machines|nics)$/.test(pathname)) &&
        // updating user config (requires checking network existence)
        !(method === 'PUT' && /\/config/.test(pathname)) &&
        // creating volumes
        !(method === 'POST' && /\/volumes$/.test(pathname))) {
        return next();
    }

    return napi.listNetworkPools({
        provisionable_by: accountUuid
    }, {
        'x-request-id': req.getId()
    }, function (err, pools) {
        if (err) {
            return next(err);
        }

        var networks = [];
        var externalNetworks = [];
        var internalNetworks = [];
        var networksInPools = {};

        // Always skip admin network pools:
        pools = pools.filter(function (pool) {
            return (pool.nic_tag !== modNetworks.ADMIN_NIC_TAG);
        });

        pools.forEach(function (pool) {
            var isFabric = false;
            networks.push(pool);

            pool.networks.forEach(function (net) {
                networksInPools[net.uuid] = true;
                if (net.fabric === true) {
                    isFabric = true;
                }
            });

            if (pool.nic_tag === modNetworks.EXTERNAL_NIC_TAG) {
                externalNetworks.push(pool.uuid);
            } else if (pool.nic_tag === modNetworks.INTERNAL_NIC_TAG ||
                isFabric === true) {
                internalNetworks.push(pool.uuid);
            }
        });

        return napi.listNetworks(netFilterOpts, {
            'x-request-id': req.getId()
        }, function (err2, nets) {
            if (err2) {
                return next(err2);
            }

            // Always skip admin networks, and don't add networks which are
            // already in contained pools:
            nets = nets.filter(function (net) {
                return net.nic_tag !== modNetworks.ADMIN_NIC_TAG &&
                    !networksInPools[net.uuid];
            });

            networks = networks.concat(nets);

            networks.forEach(function (net) {
                if (net.nic_tag === modNetworks.EXTERNAL_NIC_TAG) {
                    externalNetworks.push(net.uuid);
                } else if (net.nic_tag === modNetworks.INTERNAL_NIC_TAG ||
                    net.fabric === true) {
                    internalNetworks.push(net.uuid);
                }
            });

            // uuids of all publically-accessible networks accessible by user
            req.external_nets = externalNetworks;

            // uuids of all internally-accessible networks accessible by user
            req.internal_nets = internalNetworks;

            // objects of all networks accessible by user
            req.networks = networks;

            req.log.debug({
                external: req.external_nets,
                internal: req.internal_nets
            }, 'networks loaded');

            return next();
        });
    });
}


module.exports = {
    loadNetworks: loadNetworks
};