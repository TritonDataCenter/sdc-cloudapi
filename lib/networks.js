// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var restify = require('restify');


var ResourceNotFoundError = restify.ResourceNotFoundError;

// Note here "net" can be either network or network_pool from NAPI
function translate(req, net) {
    assert.ok(req);
    assert.ok(net);

    var obj = {
        id: net.uuid,
        name: net.name
    };

    var is_public = (typeof (net['public']) !== 'undefined') ? net['public'] :
        (net.nic_tag === 'external');

    obj['public'] = is_public;
    if (net.description) {
        obj.description = net.description;
    }

    return (obj);
}

// --- Functions
function load(req, res, next) {
    if (req.url === '/--ping') {
        return next();
    }
    assert.ok(req.account);
    assert.ok(req.sdc.napi);

    var log = req.log;

    req.nets = [];

    // Skip network loading and filtering if we're neither on networks
    // end-points or creating a machine
    if (!/\/networks/.test(req.url) &&
        !(/\/machines$/.test(req.url) && req.method.toUpperCase() === 'POST')) {
        return next();
    }

    return req.sdc.napi.listNetworks({
        provisionable_by: req.account.uuid
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, networks) {
        if (err) {
            return next(err);
        }
        // Skip admin networks, always:
        if (networks) {
            networks = networks.filter(function (net) {
                return (net.name !== 'admin');
            });
        }

        req.networks = networks || [];
        var external;

        external = networks.filter(function (net) {
            return (net.name === 'external');
        });

        if (external.length) {
            req.nets.push(external.pop().uuid);
        }

        req.external_nets = networks.filter(function (net) {
            return (net.nic_tag === 'external');
        }).map(function (net) {
            return (net.uuid);
        });

        return req.sdc.napi.listNetworkPools({
            provisionable_by: req.account.uuid
        }, {
            headers: {
                'x-request-id': req.getId()
            }
        }, function (err2, pools) {
            if (err2) {
                return next(err2);
            }
            req.network_pools = pools || [];

            if (pools) {
                pools.forEach(function (pool) {
                    req.networks.push(pool);
                    if (pool.nic_tag === 'external') {
                        req.external_nets.push(pool.uuid);
                    }
                });
            }

            log.debug({
                selected: req.nets,
                external: req.external_nets
            }, 'networks loaded');

            return next();
        });
    });
}


function list(req, res, next) {
    var log = req.log;
    var networks = [];
    var networks_in_pools = [];

    // PUBAPI-622: In order to simplify listing, when a network is included
    // into a network_pool, we'll skip it from the listing, given we already
    // have a pool including such network in our list
    req.network_pools.forEach(function (p) {
        networks_in_pools = networks_in_pools.concat(p.networks);
    });

    req.networks.forEach(function (n) {
        if (networks_in_pools.indexOf(n.uuid) === -1) {
            networks.push(translate(req, n));
        }
    });

    log.debug({
        networks: networks,
        account: req.account.login
    }, 'ListNetworks done');

    res.send(networks);
    return next();
}

function get(req, res, next) {
    var log = req.log;
    var _n = req.params.network;
    var net = req.networks.filter(function (n) {
        return (n.uuid === _n);
    });
    var network;

    if (!net.length) {
        return next(new ResourceNotFoundError('%s not found', _n));
    }
    network = translate(req, net[0]);

    log.debug({
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
