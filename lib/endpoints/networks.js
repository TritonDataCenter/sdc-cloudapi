/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var jsprim = require('jsprim');
var restify = require('restify');
var schemas = require('joyent-schemas').cloudapi;
var util = require('util');
var vasync = require('vasync');

var modNetworks = require('../networks');
var resources = require('../resources');

var InternalError = restify.InternalError;
var InvalidArgumentError = restify.InvalidArgumentError;
var ResourceNotFoundError = restify.ResourceNotFoundError;
var MissingParameterError = restify.MissingParameterError;

var FABRIC_VLAN_FIELDS = ['description', 'name', 'vlan_id'];
var FABRIC_NETWORK_FIELDS = ['description', 'fabric', 'gateway',
    'internet_nat', 'name', 'provision_end_ip', 'provision_start_ip',
    'resolvers', 'routes', 'subnet', 'uuid', 'vlan_id'];
// Fields that are IPv4 addresses:
var IP_FIELDS = ['gateway', 'provision_end_ip', 'provision_start_ip',
    'resolvers', 'resolvers[0]', 'resolvers[1]', 'resolvers[2]',
    'resolvers[3]'];
var MAX_RESOLVERS = 4;
// Fields for Listing/Getting IPs
var NETWORK_IP_FIELDS = ['ip', 'reserved', 'owner_uuid', 'belongs_to_uuid'];


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
 * Return an error if the network is not valid for the user
 */
function validateNetworkForIps(req, res, next) {
    var networkUuid = req.params.id;

    var net = req.networks.find(function (n) {
        return (n.uuid === networkUuid);
    });

    if (!net) {
        return next(new ResourceNotFoundError('%s not found', networkUuid));
    }

    // Support for network pools is being tracked in PUBAPI-1441
    if (Array.isArray(net.networks)) {
        return next(new InvalidArgumentError('cannot get IPs in a network'
            + ' pool: %s', net.uuid));
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
    assert.object(net, 'net');

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
        isPublic = (net.nic_tag === modNetworks.EXTERNAL_NIC_TAG);
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

/*
 * Translate from an napi ip object to a cloudapi ip payload
 *
 * Fields exposed:
 * - ip: always sent
 * - reserved: always sent
 * - managed: always sent (true when belongs_to_uuid == "other" ||
 *   owner_uuid == adminUuid)
 * - owner_uuid: only sent if the belongs_to_uuid field is set in the
 *   napi object and it is not the adminUuid
 * - belongs_to_uuid: if the field is set in napi, then we send it
 *   only if the owner_uuid matches the uuid of the user making the request
 *
 *   Future fields:
 *   - belongs_to_type: if/when napi becomes more descriptive providing
 *   information like nat, router, volume etc
 */
function translateIp(ip, accountUuid, adminUuid) {
    assert.object(ip, 'ip');
    assert.uuid(accountUuid, 'accountUuid');
    assert.uuid(adminUuid, 'adminUuid');

    var obj = {};

    NETWORK_IP_FIELDS.forEach(function (p) {
        if (ip.hasOwnProperty(p)) {
            obj[p] = ip[p];
        }
    });

    obj.managed = (ip.belongs_to_type === 'other' ||
        ip.owner_uuid === adminUuid);

    // Show users the IP but don't leak belongs_to_uuid or the admin uuid
    if (obj.managed) {
        delete obj.owner_uuid;
        delete obj.belongs_to_uuid;
    }

    /*
     * On networks with more than one owner we only expose belongs_to_uuid
     * when the owner_uuid matches the user making the request
     */
    if (ip.owner_uuid !== accountUuid) {
        delete obj.belongs_to_uuid;
    }

    return (obj);
}


// --- Functions

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

function listNetworkIps(req, res, next) {
    var napi = req.sdc.napi;
    assert.ok(napi);

    var adminUuid = req.config.ufds_admin_uuid;
    assert.uuid(adminUuid, 'admin uuid');

    var networkUuid = req.params.id;
    //validateNetwork should have already vaidated this exists
    var net = req.networks.find(function findNetwork(n) {
        return n.uuid === networkUuid;
    });
    assert.ok(net);

    // If its a public network we need to filter by owner_uuid
    var opts = net.hasOwnProperty('owner_uuids') ?
        {} : { owner_uuid: req.account.uuid };

    /*
     * NAPI-437 We eventually would rather have napi support markers instead of
     * offsets. These defaults currently map to napi's default limit and offset
     * values
     */
    opts.limit = req.params.limit || 1000;
    opts.offset = req.params.offset || 0;

    return napi.listIPs(networkUuid, opts, reqOpts(req),
        function napiListIPs(err, ips) {
        if (err) {
            return next(translateErr(err));
        }

        ips = ips.filter(function (ip) {
            return ip.belongs_to_uuid || ip.reserved;
        });

        ips = ips.map(function translateIps(ip) {
            return translateIp(ip, req.account.uuid, adminUuid);
        });

        res.header('x-query-limit', opts.limit);
        res.header('x-resource-count', ips.length);

        req.log.debug({
            ips: ips,
            account: req.account.login
        }, 'ListNetworkIPs done');

        res.send(ips);
        return next();
    });
}

function getNetworkIp(req, res, next) {
    var napi = req.sdc.napi;
    assert.ok(napi);

    var adminUuid = req.config.ufds_admin_uuid;
    assert.uuid(adminUuid, 'admin uuid');

    var networkUuid = req.params.id;
    var _ip = req.params.ip_address;

    //validateNetwork should have already vaidated this exists
    var net = req.networks.find(function findNetwork(n) {
        return n.uuid === networkUuid;
    });
    assert.ok(net);

    return napi.getIP(networkUuid, _ip, function napiGetIP(err, ip) {
        if (err) {
            return next(translateErr(err));
        }

        // If its a public network we need to verify the owner_uuid
        if (!net.hasOwnProperty('owner_uuids')) {
            if (ip.owner_uuid !== req.account.uuid) {
                return next(new ResourceNotFoundError('%s not found', _ip));
            }
        }

        ip = translateIp(ip, req.account.uuid, adminUuid);

        req.log.debug({
            ip: ip,
            networkUuid: networkUuid,
            account: req.account.login
        }, 'GetNetworkIP done');

        res.send(ip);
        return next();
    });
}

/*
 * Update a network ip under the following conditions:
 * - The IP is not on a public network
 * - The IP is not 'managed'
 * - The IP is anywhere within the subnet (napi enforced)
 * - The IP is not in use by another account on a shared
 *   private network
 */
function updateNetworkIp(req, res, next) {
    var napi = req.sdc.napi;
    assert.ok(napi, 'napi');

    var adminUuid = req.config.ufds_admin_uuid;
    assert.uuid(adminUuid, 'admin uuid');

    var networkUuid = req.params.id;
    var _ip = req.params.ip_address;
    var userIp;

    if (!Object.prototype.hasOwnProperty.call(req.params, 'reserved')) {
        return next(new MissingParameterError(
            'reserved is a required argument'));
    }
    var reserved = req.params.reserved;

    /*
     * cloudapi allows req.param's to come from queryParser and bodyParser.
     * Since queryParser will give use a string and body parser will give us
     * a boolean or a string, we need to map this to the right value. We return
     * an error otherwise.
     */
    switch (typeof (reserved)) {
    case 'boolean':
        break;
    case 'string':
        switch (reserved) {
        case 'true':
            reserved = true;
            break;
        case 'false':
            reserved = false;
            break;
        default:
            return next(new InvalidArgumentError(
                'reserved must be set to true or false'));
        }
        break;
    default:
        return next(new InvalidArgumentError(
            'reserved must be set to true or false'));
    }

    assert.bool(reserved, 'reserved');

    // validateNetworkForIps should have already validated this exists
    var net = req.networks.find(function findNetwork(n) {
        return n.uuid === networkUuid;
    });
    assert.object(net, 'net object');

    // If it's a public network we don't allow ip reservations
    if (!net.hasOwnProperty('owner_uuids')) {
        return next(new InvalidArgumentError(
            'cannot update an IP on a public network: ' + networkUuid));
    }

    var pipeline = [
        function _getIp(_, cb) {
            napi.getIP(networkUuid, _ip, function getIP(err, ip) {
                if (err) {
                    cb(translateErr(err));
                    return;
                }

                userIp = translateIp(ip, req.account.uuid, adminUuid);
                cb();
            });
        },
        function _updateIp(_, cb) {
            if (userIp.managed === true) {
                cb(new InvalidArgumentError(
                    'cannot update managed IP: ' + _ip));
                return;
            }

            if (userIp.hasOwnProperty('owner_uuid') &&
                userIp.owner_uuid !== req.account.uuid) {
                cb(new InvalidArgumentError(
                    'IP %s on network %s is in use by another account', _ip,
                        networkUuid));
                return;
            }

            var opts = {reserved: reserved};
            napi.updateIP(networkUuid, _ip, opts, function updateIp(err, ip) {
                if (err) {
                    cb(translateErr(err));
                    return;
                }

                userIp = translateIp(ip, req.account.uuid, adminUuid);
                cb();
            });
        }
    ];

    return vasync.pipeline({
        funcs: pipeline
    }, function (err, results) {
        if (err) {
            return next(err);
        }

        res.send(userIp);
        return next();
    });
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

function updateFabricNetwork(req, res, next) {
    var params;
    var vlanID;
    var id;
    assert.ok(req.account);
    assert.ok(req.sdc.napi);

    if (req.body && req.body.id) {
        return next(new InvalidArgumentError(util.format(
            'property "id": cannot be set')));
    }

    try {
        params = schemaValidate(schemas.UpdateFabricNetwork, req);
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
    id = params.id;
    delete params.id;
    params.fields = FABRIC_NETWORK_FIELDS;

    return req.sdc.napi.updateFabricNetwork(req.account.uuid, vlanID, id,
            params, function (err, network) {
        if (err) {
            return next(translateErr(err));
        }

        res.send(translateNetwork(network));
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

        res.send(networks.map(function _translateNetwork(network) {
            assert.object(network, 'network');

            return translateNetwork(network);
        }));

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

    return modNetworks.getDefaultFabricNetworkForUser(req.sdc.ufds,
        req.config.datacenter_name, req.account, {
        log: req.log
    }, function _afterGetConf(getFabricNetErr, defaultFabricNet) {
        if (getFabricNetErr) {
            return next(getFabricNetErr);
        }

        if (!defaultFabricNet) {
            return next(new InternalError('Could not find default fabric ' +
                'network for user'));
        }

        req.log.info({
            networkToDelete: params.id,
            defaultNetwork: defaultFabricNet.uuid
        }, 'Deleting default network?');

        if (params.id === defaultFabricNet.uuid) {
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


function mountNetworks(server, before, pre) {
    assert.object(server, 'server');
    assert.ok(before, 'before');
    assert.optionalArrayOfFunc(pre, 'pre');

    pre = pre || [];

    // --- Fabric VLANs

    server.get({
        path: '/:account/fabrics/default/vlans',
        name: 'ListFabricVLANs',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, listFabricVLANs);

    server.head({
        path: '/:account/fabrics/default/vlans',
        name: 'HeadFabricVLANs',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, listFabricVLANs);

    server.post({
        path: '/:account/fabrics/default/vlans',
        name: 'CreateFabricVLAN',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, createFabricVLAN);

    server.put({
        path: '/:account/fabrics/default/vlans/:vlan_id',
        name: 'UpdateFabricVLAN',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, updateFabricVLAN);

    server.get({
        path: '/:account/fabrics/default/vlans/:vlan_id',
        name: 'GetFabricVLAN',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, getFabricVLAN);

    server.head({
        path: '/:account/fabrics/default/vlans/:vlan_id',
        name: 'GetFabricVLAN',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, getFabricVLAN);

    server.del({
        path: '/:account/fabrics/default/vlans/:vlan_id',
        name: 'DeleteFabricVLAN',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, deleteFabricVLAN);

    // --- Fabric Networks

    server.get({
        path: '/:account/fabrics/default/vlans/:vlan_id/networks',
        name: 'ListFabricNetworks',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, listFabricNetworks);

    server.head({
        path: '/:account/fabrics/default/vlans/:vlan_id/networks',
        name: 'HeadFabricNetworks',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, listFabricNetworks);

    server.post({
        path: '/:account/fabrics/default/vlans/:vlan_id/networks',
        name: 'CreateFabricNetwork',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, createFabricNetwork);

    server.get({
        path: '/:account/fabrics/default/vlans/:vlan_id/networks/:id',
        name: 'GetFabricNetwork',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, getFabricNetwork);

    server.head({
        path: '/:account/fabrics/default/vlans/:vlan_id/networks/:id',
        name: 'GetFabricNetwork',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, getFabricNetwork);

    server.put({
        path: '/:account/fabrics/default/vlans/:vlan_id/networks/:id',
        name: 'UpdateFabricNetwork',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, updateFabricNetwork);

    server.del({
        path: '/:account/fabrics/default/vlans/:vlan_id/networks/:id',
        name: 'DeleteFabricNetwork',
        version: [ '7.3.0', '8.0.0' ]
    }, before, ensureFabricsEnabled, pre, deleteFabricNetwork);

    // --- Networks (non-fabric)

    server.get({
        path: '/:account/networks',
        name: 'ListNetworks'
    }, before, pre, listNetworks);

    server.head({
        path: '/:account/networks',
        name: 'HeadNetworks'
    }, before, pre, listNetworks);

    server.get({
        path: '/:account/networks/:network',
        name: 'GetNetwork'
    }, before, pre, getNetwork);

    server.head({
        path: '/:account/networks/:network',
        name: 'HeadNetwork'
    }, before, pre, getNetwork);

    // --- Network IPs

    server.get({
        path: '/:account/networks/:id/ips',
        name: 'ListNetworkIPs'
    }, before, pre, validateNetworkForIps, listNetworkIps);

    server.head({
        path: '/:account/networks/:id/ips',
        name: 'HeadNetworkIPs'
    }, before, pre, validateNetworkForIps, listNetworkIps);

    server.put({
        path: '/:account/networks/:id/ips/:ip_address',
        name: 'UpdateNetworkIP'
    }, before, pre, validateNetworkForIps, updateNetworkIp);

    server.get({
        path: '/:account/networks/:id/ips/:ip_address',
        name: 'GetNetworkIP'
    }, before, pre, validateNetworkForIps, getNetworkIp);

    server.head({
        path: '/:account/networks/:id/ips/:ip_address',
        name: 'HeadNetworkIP'
    }, before, pre, validateNetworkForIps, getNetworkIp);

    return server;
}


// --- API

module.exports = {
    mount: mountNetworks
};
