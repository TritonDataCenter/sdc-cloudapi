/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var assert = require('assert');
var util = require('util');
var mod_config = require('./config');
var restify = require('restify');
var schemas = require('joyent-schemas').cloudapi;
var jsprim = require('jsprim');
var vasync = require('vasync');

var resources = require('./resources');
var ResourceNotFoundError = restify.ResourceNotFoundError;
var InvalidArgumentError = restify.InvalidArgumentError;

var EXTERNAL_NIC_TAG = 'external';
var INTERNAL_NIC_TAG = 'internal';
var ADMIN_NIC_TAG    = 'admin';
var FABRIC_VLAN_FIELDS = ['description', 'name', 'vlan_id'];
var FABRIC_NETWORK_FIELDS = ['description', 'fabric', 'gateway',
    'internet_nat', 'name', 'provision_end_ip', 'provision_start_ip',
    'resolvers', 'routes', 'subnet', 'uuid', 'vlan_id'];
// Fields that are IPv4 addresses:
var IP_FIELDS = ['gateway', 'provision_end_ip', 'provision_start_ip',
    'resolvers', 'resolvers[0]', 'resolvers[1]', 'resolvers[2]',
    'resolvers[3]'];
var MAX_RESOLVERS = 4;


/*
 * Return an error if fabrics are not enabled in this DC
 */
function ensureFabricsEnabled(req, res, next) {
    if (!req.config.fabrics_enabled) {
        return next(new restify.NotImplementedError(
                'fabrics not enabled for this datacenter'));
    }

    return next();
}


/*
 * Return request options suitable for making requests to other APIs
 */
function reqOpts(req) {
    return { headers: { 'x-request-id': req.getId() } };
}


/*
 * Validate req.params against the given schema, and transform any parameters
 * as necessary.
 */
function schemaValidate(schema, req) {
    var err;
    var params = jsprim.deepCopy(req.params);

    delete params.account;
    err = jsprim.validateJsonObject(schema, params);
    if (err) {
        if (IP_FIELDS.indexOf(err.jsv_details.property) !== -1 &&
                err.message.match(/does not match the regex pattern/)) {
            throw new InvalidArgumentError(err,
                    util.format('property "%s": must be an IPv4 address',
                    err.jsv_details.property));
        }

        throw new InvalidArgumentError(err, err.message);
    }

    if (params.hasOwnProperty('vlan_id')) {
        params.vlan_id = Number(params.vlan_id);
    }

    return params;
}


/**
 * Translate a NAPI error to a cloudapi-style error
 */
function translateErr(err) {
    var msg = err.message;

    if (err.body && err.body.errors && err.body.errors.length !== 0) {
        msg = err.body.errors.map(function (bErr) {
            if (!bErr.field) {
                return bErr.message;
            }

            return util.format('property "%s": %s', bErr.field, bErr.message);
        }).join(', ');
    }

    if (err.statusCode === 404) {
        return new ResourceNotFoundError(err, msg);
    } else {
        return new InvalidArgumentError(err, msg);
    }
}


// Note here "net" can be a network, fabric network or network_pool from NAPI
function translateNetwork(net) {
    assert.ok(net);

    var obj = {
        id: net.uuid,
        name: net.name
    };

    var isPublic;
    if (typeof (net['public']) !== 'undefined') {
        isPublic = net['public'];
    } else if (net.fabric) {
        isPublic = false;
    } else {
        isPublic = (net.nic_tag === EXTERNAL_NIC_TAG);
    }

    obj['public'] = isPublic;

    if (net.description) {
        obj.description = net.description;
    }

    if (net.fabric) {
        FABRIC_NETWORK_FIELDS.forEach(function (p) {
            if (p === 'uuid') {
                return;
            }

            if (net.hasOwnProperty(p)) {
                obj[p] = net[p];
            }
        });
    }

    return (obj);
}


// --- Functions
function preLoadNetworks(req, res, next) {
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

    // Skip network loading and filtering if we're neither on networks
    // end-points, creating a machine or updating the user's config
    // (which requires checking network existence)
    if (!/\/networks/.test(pathname) && !((/\/machines$/.test(pathname) &&
        method === 'POST')) && !(/\/config/.test(pathname) &&
        method === 'PUT')) {
        return next();
    }

    return napi.listNetworkPools({
        provisionable_by: accountUuid
    }, reqOpts(req), function (err, pools) {
        if (err) {
            return next(err);
        }

        var networks = [];
        var externalNetworks = [];
        var internalNetworks = [];
        var networksInPools = {};

        // Always skip admin network pools:
        pools = pools.filter(function (pool) {
            return (pool.nic_tag !== ADMIN_NIC_TAG);
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

            if (pool.nic_tag === EXTERNAL_NIC_TAG) {
                externalNetworks.push(pool.uuid);
            } else if (pool.nic_tag === INTERNAL_NIC_TAG || isFabric === true) {
                internalNetworks.push(pool.uuid);
            }
        });

        return napi.listNetworks(netFilterOpts, reqOpts(req),
                function (err2, nets) {
            if (err2) {
                return next(err2);
            }

            // Always skip admin networks, and don't add networks which are
            // already in contained pools:
            nets = nets.filter(function (net) {
                return net.nic_tag !== ADMIN_NIC_TAG &&
                    !networksInPools[net.uuid];
            });

            networks = networks.concat(nets);

            networks.forEach(function (net) {
                if (net.nic_tag === EXTERNAL_NIC_TAG) {
                    externalNetworks.push(net.uuid);
                } else if (net.nic_tag === INTERNAL_NIC_TAG ||
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


function listNetworks(req, res, next) {
    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }

    var fabricsOnly = req.query && req.query.fabric;
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
        if (fabricsOnly && !n.fabric) {
            return false;
        }

        // assuming this list never gets too big
        return skipNetworkUuids.indexOf(n.uuid) === -1;
    }).map(function (pool) {
        return translateNetwork(pool);
    });

    req.log.debug({
        networks: networks,
        account: req.account.login
    }, 'ListNetworks done');

    res.send(networks);
    return next();
}


function getNetwork(req, res, next) {
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

    network = translateNetwork(net[0]);

    req.log.debug({
        network: network,
        account: req.account.login
    }, 'GetNetwork');

    res.send(network);
    return next();
}


function listFabricVLANs(req, res, next) {
    assert.ok(req.account);
    assert.ok(req.sdc.napi);

    var params = {
        fields: FABRIC_VLAN_FIELDS
    };

    return req.sdc.napi.listFabricVLANs(req.account.uuid, params, reqOpts(req),
            function (err, vlans) {
        if (err) {
            return next(translateErr(err));
        }

        req.log.debug({
            vlans: vlans,
            account: req.account.login
        }, 'ListFabricVLANs done');

        res.send(vlans);
        return next();
    });
}


function createFabricVLAN(req, res, next) {
    var params;

    assert.ok(req.account);
    assert.ok(req.sdc.napi);

    try {
        params = schemaValidate(schemas.CreateFabricVLAN, req);
    } catch (schemaErr) {
        return next(schemaErr);
    }

    params.fields = FABRIC_VLAN_FIELDS;

    return req.sdc.napi.createFabricVLAN(req.account.uuid, params,
            reqOpts(req), function (err, vlan) {
        if (err) {
            return next(translateErr(err));
        }

        res.send(201, vlan);
        return next();
    });
}


function updateFabricVLAN(req, res, next) {
    var params;
    var vlanID;

    assert.ok(req.account);
    assert.ok(req.sdc.napi);

    try {
        params = schemaValidate(schemas.UpdateFabricVLAN, req);
    } catch (schemaErr) {
        return next(schemaErr);
    }

    vlanID = params.vlan_id;
    delete params.vlan_id;
    params.fields = FABRIC_VLAN_FIELDS;

    return req.sdc.napi.updateFabricVLAN(req.account.uuid, vlanID, params,
            reqOpts(req), function (err, vlan) {
        if (err) {
            return next(translateErr(err));
        }

        res.send(202, vlan);
        return next();
    });
}


function getFabricVLAN(req, res, next) {
    var params;

    assert.ok(req.account);
    assert.ok(req.sdc.napi);

    try {
        params = schemaValidate(schemas.GetFabricVLAN, req);
    } catch (schemaErr) {
        return next(schemaErr);
    }

    params.fields = FABRIC_VLAN_FIELDS;

    return req.sdc.napi.getFabricVLAN(req.account.uuid, params.vlan_id, params,
            reqOpts(req), function (err, vlan) {
        if (err) {
            return next(translateErr(err));
        }
        res.send(vlan);
        return next();
    });
}


function deleteFabricVLAN(req, res, next) {
    var params;

    assert.ok(req.account);
    assert.ok(req.sdc.napi);

    try {
        params = schemaValidate(schemas.DeleteFabricVLAN, req);
    } catch (schemaErr) {
        return next(schemaErr);
    }

    return req.sdc.napi.deleteFabricVLAN(req.account.uuid, params.vlan_id, {},
            reqOpts(req), function (err, ignored) {
        if (err) {
            return next(translateErr(err));
        }
        res.send(204);
        return next();
    });
}


function listFabricNetworks(req, res, next) {
    var params;

    assert.ok(req.account);
    assert.ok(req.sdc.napi);

    try {
        params = schemaValidate(schemas.ListFabricNetworks, req);
    } catch (schemaErr) {
        return next(schemaErr);
    }

    return req.sdc.napi.listFabricNetworks(req.account.uuid, params.vlan_id, {},
            reqOpts(req), function (err, networks) {
        if (err) {
            return next(translateErr(err));
        }

        res.send(networks.map(translateNetwork));
        return next();
    });
}


function createFabricNetwork(req, res, next) {
    var params;
    var vlanID;

    assert.ok(req.account);
    assert.ok(req.sdc.napi);

    try {
        params = schemaValidate(schemas.CreateFabricNetwork, req);
        if (params.resolvers && params.resolvers.length > MAX_RESOLVERS) {
            throw new InvalidArgumentError(util.format(
                    'property "resolvers": maximum of %d resolvers',
                    MAX_RESOLVERS));
        }
    } catch (schemaErr) {
        return next(schemaErr);
    }

    vlanID = params.vlan_id;
    delete params.vlan_id;
    params.fields = FABRIC_NETWORK_FIELDS;

    return req.sdc.napi.createFabricNetwork(req.account.uuid, vlanID, params,
            reqOpts(req), function (err, network) {
        if (err) {
            return next(translateErr(err));
        }

        res.send(201, translateNetwork(network));
        return next();
    });
}


function getFabricNetwork(req, res, next) {
    var params;

    assert.ok(req.account);
    assert.ok(req.sdc.napi);

    try {
        params = schemaValidate(schemas.GetFabricNetwork, req);
    } catch (schemaErr) {
        return next(schemaErr);
    }

    return req.sdc.napi.getFabricNetwork(req.account.uuid, params.vlan_id,
            params.id, { fields: FABRIC_NETWORK_FIELDS }, reqOpts(req),
            function (err, network) {
        if (err) {
            return next(translateErr(err));
        }

        res.send(translateNetwork(network));
        return next();
    });
}


function deleteFabricNetwork(req, res, next) {
    var params;

    assert.ok(req.account);
    assert.ok(req.sdc.napi);

    try {
        params = schemaValidate(schemas.DeleteFabricNetwork, req);
    } catch (schemaErr) {
        return next(schemaErr);
    }

    return mod_config.get(req, function _afterGetConf(confErr, conf) {
        if (confErr) {
            return next(confErr);
        }

        if (params.id === conf.default_network) {
            return next(new InvalidArgumentError(
                    'cannot delete default network'));
        }

        return req.sdc.napi.deleteFabricNetwork(req.account.uuid,
                params.vlan_id, params.id, {}, reqOpts(req), function (err) {
            if (err) {
                return next(translateErr(err));
            }

            res.send(204);
            return next();
        });
    });
}


function mountNetworks(server, before) {
    assert.argument(server, 'object', server);

    var beforeArr = Array.isArray(before) ? before : [before];
    var fabricsRequired = beforeArr.concat(ensureFabricsEnabled);

    // --- Fabric VLANs

    server.get({
        path: '/:account/fabrics/default/vlans',
        name: 'ListFabricVLANs',
        version: [ '7.3.0' ]
    }, fabricsRequired, listFabricVLANs);

    server.head({
        path: '/:account/fabrics/default/vlans',
        name: 'HeadFabricVLANs',
        version: [ '7.3.0' ]
    }, fabricsRequired, listFabricVLANs);

    server.post({
        path: '/:account/fabrics/default/vlans',
        name: 'CreateFabricVLAN',
        version: [ '7.3.0' ]
    }, fabricsRequired, createFabricVLAN);

    server.put({
        path: '/:account/fabrics/default/vlans/:vlan_id',
        name: 'UpdateFabricVLAN',
        version: [ '7.3.0' ]
    }, fabricsRequired, updateFabricVLAN);

    server.get({
        path: '/:account/fabrics/default/vlans/:vlan_id',
        name: 'GetFabricVLAN',
        version: [ '7.3.0' ]
    }, fabricsRequired, getFabricVLAN);

    server.head({
        path: '/:account/fabrics/default/vlans/:vlan_id',
        name: 'GetFabricVLAN',
        version: [ '7.3.0' ]
    }, fabricsRequired, getFabricVLAN);

    server.del({
        path: '/:account/fabrics/default/vlans/:vlan_id',
        name: 'DeleteFabricVLAN',
        version: [ '7.3.0' ]
    }, fabricsRequired, deleteFabricVLAN);

    // --- Fabric Networks

    server.get({
        path: '/:account/fabrics/default/vlans/:vlan_id/networks',
        name: 'ListFabricNetworks',
        version: [ '7.3.0' ]
    }, fabricsRequired, listFabricNetworks);

    server.head({
        path: '/:account/fabrics/default/vlans/:vlan_id/networks',
        name: 'HeadFabricNetworks',
        version: [ '7.3.0' ]
    }, fabricsRequired, listFabricNetworks);

    server.post({
        path: '/:account/fabrics/default/vlans/:vlan_id/networks',
        name: 'CreateFabricNetwork',
        version: [ '7.3.0' ]
    }, fabricsRequired, createFabricNetwork);

    server.get({
        path: '/:account/fabrics/default/vlans/:vlan_id/networks/:id',
        name: 'GetFabricNetwork',
        version: [ '7.3.0' ]
    }, fabricsRequired, getFabricNetwork);

    server.head({
        path: '/:account/fabrics/default/vlans/:vlan_id/networks/:id',
        name: 'GetFabricNetwork',
        version: [ '7.3.0' ]
    }, fabricsRequired, getFabricNetwork);

    server.del({
        path: '/:account/fabrics/default/vlans/:vlan_id/networks/:id',
        name: 'DeleteFabricNetwork',
        version: [ '7.3.0' ]
    }, fabricsRequired, deleteFabricNetwork);

    // --- Networks (non-fabric)

    server.get({
        path: '/:account/networks',
        name: 'ListNetworks'
    }, before || listNetworks, before ? listNetworks : undefined);

    server.head({
        path: '/:account/networks',
        name: 'HeadNetworks'
    }, before || listNetworks, before ? listNetworks : undefined);

    server.get({
        path: '/:account/networks/:network',
        name: 'GetNetwork'
    }, before || getNetwork, before ? getNetwork : undefined);

    server.head({
        path: '/:account/networks/:network',
        name: 'HeadNetwork'
    }, before || getNetwork, before ? getNetwork : undefined);

    return server;
}


// --- API

module.exports = {
    loadNetworks: preLoadNetworks,
    mount: mountNetworks
};
