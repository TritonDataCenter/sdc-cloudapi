/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */


/*
 * This middleware module is responsible for adding the following properties to
 * the request ('req') object:
 *
 *    * external_nets: uuids of all publically-accessible networks accessible by
 *                     the requesting user
 *
 *    * internal_nets: uuids of all internally-accessible networks accessible
 *                     by the requesting user
 *
 *    * networks:      full NAPI network objects of all of the networks
 *                     accessible by the requesting user
 */
var assert = require('assert-plus');
var netconf = require('triton-netconfig');


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

        var plugins = req.plugins;
        var networks = [];
        var externalNetworks = [];
        var internalNetworks = [];
        var networksInPools = {};

        // Always skip admin network pools:
        pools = pools.filter(function (pool) {
            return (!netconf.isNetAdmin(pool));
        });

        pools = plugins.filterListNetworks({ account: req.account }, pools);

        pools.forEach(function (pool) {
            var isFabric = false;
            networks.push(pool);

            pool.networks.forEach(function (net) {
                networksInPools[net.uuid] = true;
                if (net.fabric === true) {
                    isFabric = true;
                }
            });

            if (netconf.isNetExternal(pool)) {
                externalNetworks.push(pool.uuid);
            } else if (netconf.isNetInternal(pool) || isFabric === true) {
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
                return (!netconf.isNetAdmin(net) && !networksInPools[net.uuid]);
            });

            nets = plugins.filterListNetworks({ account: req.account }, nets);

            networks = networks.concat(nets);

            networks.forEach(function (net) {
                if (netconf.isNetExternal(net)) {
                    externalNetworks.push(net.uuid);
                } else if (netconf.isNetInternal(net) || net.fabric === true) {
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
