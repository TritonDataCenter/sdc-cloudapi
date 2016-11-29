/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Virtual Machines or customer "instances".
 */

var assert = require('assert-plus');
var util = require('util');

var restify = require('restify');
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var clone = require('clone');
var vasync = require('vasync');

var images = require('./datasets');
var resources = require('./resources');
var membership = require('./membership'),
    preloadGroups = membership.preloadGroups;
var semver = require('semver');

// --- Globals

var InvalidArgumentError = restify.InvalidArgumentError;
var MissingParameterError = restify.MissingParameterError;
var ResourceNotFoundError = restify.ResourceNotFoundError;
var InternalError = restify.InternalError;
var RestError = restify.RestError;

var MD_RE = /^metadata\.\w/;
var TAG_RE = /^tag\..+/;
var BEFORE_NETWORK_VERSION_RE = /^~?7\.0(\.\d+)?$/;

var EXTERNAL_NIC_TAG = 'external';
var INTERNAL_NIC_TAG = 'internal';
// networks used if pkg doesn't have any
var DEFAULT_NETWORKS = [EXTERNAL_NIC_TAG, INTERNAL_NIC_TAG];

var PKG_USED_PARAMS = ['uuid', 'max_physical_memory', 'name', 'version',
        'networks', 'active', 'default', 'owner_uuids', 'fss', 'os'];

var sprintf = util.format;



// --- Helpers


function KeyRequiredError() {

    var message = 'At least one SSH key is required to provision';

    RestError.call(this, {
        statusCode: 409,
        restCode: 'KeyRequired',
        message: message,
        constructorOpt: KeyRequiredError
    });

    this.name = 'KeyRequiredError';
}
util.inherits(KeyRequiredError, RestError);


function translateState(state) {
    switch (state) {
    case 'configured':
    case 'incomplete':
    case 'unavailable':
    case 'provisioning':
        state = 'provisioning';
        break;
    // Cause ready happens now during reboot only:
    case 'ready':
        state = 'ready';
        break;
    case 'running':
        state = 'running';
        break;
    case 'halting':
    case 'stopping':
    case 'shutting_down':
        state = 'stopping';
        break;
    case 'off':
    case 'down':
    case 'installed':
    case 'stopped':
        state = 'stopped';
        break;
    case 'unreachable':
        state = 'offline';
        break;
    case 'destroyed':
        state = 'deleted';
        break;
    case 'failed':
        state = 'failed';
        break;
    default:
        state = 'unknown';
        break;
    }

    return state;
}


function translate(machine, req)  {
    assert.ok(machine);

    var credentials = req.params.credentials;
    var version = req.getVersion();

    var msg = {
        id: machine.uuid,
        name: machine.alias,
        type: machine.brand === 'kvm' ? 'virtualmachine' : 'smartmachine',
        brand: machine.brand,
        state: translateState(machine.state),
        image: machine.image_uuid,
        ips: [],
        memory: Number(machine.ram),
        disk: (Number(machine.quota) * 1024) || 0,
        metadata: machine.customer_metadata || {},
        tags: machine.tags,
        credentials: credentials,
        created: machine.create_timestamp || (new Date()).toISOString(),
        updated: machine.last_modified || (new Date()).toISOString()
    };

    if (machine.docker) {
        msg.docker = true;
    }

    if (!BEFORE_NETWORK_VERSION_RE.test(version)) {
        msg.networks = [];
    }

    if (msg.type === 'virtualmachine' && machine.disks[0]) {
        msg.image = machine.disks[0].image_uuid;
    }

    if (msg.type === 'virtualmachine' && machine.disks[1] &&
            machine.disks[1].size) {
        msg.disk = Number(machine.disks[1].size);
    }

    if (machine.nics && machine.nics.length) {
        machine.nics.forEach(function (nic) {
            msg.ips.push(nic.ip);
            if (!BEFORE_NETWORK_VERSION_RE.test(version)) {
                msg.networks.push(nic.network_uuid);
            }
        });

        var primaryNic = machine.nics.filter(function (nic) {
            return nic.primary;
        })[0];

        // For backwards-compat. Some old VMs don't have a primary
        // attribute set on their nics, but have an 'external' nic tag.
        if (!primaryNic) {
            primaryNic = machine.nics.filter(function (nic) {
                return nic.nic_tag === EXTERNAL_NIC_TAG;
            }).pop();
        }

        // if we found nothing yet, just pick any NIC
        primaryNic = primaryNic || machine.nics[0];

        msg.primaryIp = primaryNic ? primaryNic.ip : '';
    }

    if (credentials && machine.internal_metadata &&
        typeof (machine.internal_metadata) === 'object') {
        msg.metadata.credentials = {};
        Object.keys(machine.internal_metadata).forEach(function (k) {
            if (/_pw$/.test(k)) {
                msg.metadata.credentials[k.replace(/_pw$/, '')] =
                    machine.internal_metadata[k];
            }
        });

        // Do not keep around when empty:
        if (msg.metadata.credentials &&
            typeof (msg.metadata.credentials) === 'object' &&
            Object.keys(msg.metadata.credentials).length === 0) {
            delete msg.metadata.credentials;
        }
    }

    if (typeof (machine.firewall_enabled) !== 'undefined') {
        msg.firewall_enabled = machine.firewall_enabled;
    }

    if (typeof (machine.server_uuid) !== 'undefined') {
        msg.compute_node = machine.server_uuid;
    }

    if (machine.billing_id && req.packages) {
        var packages = req.packages.filter(function (d) {
            return (d.uuid === machine.billing_id);
        });
        msg.package = packages[0] ? packages[0].name : '';
    } else {
        msg.package = '';
    }

    if (machine.dns_names !== undefined) {
        msg.dns_names = machine.dns_names;
    }

    return msg;
}


// Note the throws in this function are ok, as restify is contractually
// obligated to catch them and do res.send for us
function getListOptions(req) {
    assert.ok(req);

    var opts = {};

    switch (req.params.state) {
    case 'provisioning':
        opts.state = 'active';
        break;
    case 'stopping':
        opts.state = 'active';
        break;
    case 'active':
        opts.state = 'active';
        break;
    case 'stopped':
        opts.state = 'stopped';
        break;
    case 'running':
        opts.state = 'running';
        break;
    case 'unknown':
        opts.state = 'unknown';
        break;
    case 'destroyed':
        opts.state = 'destroyed';
        break;
    case undefined:
        break;
    default:
        throw new InvalidArgumentError('%s is not a valid state',
                                        req.params.state);
    }

    switch (req.params.type) {
    case 'smartmachine':
        opts.predicate = '{ "ne": [ "brand", "kvm" ] }';
        break;
    case 'virtualmachine':
        opts.predicate = '{ "eq": [ "brand", "kvm" ] }';
        break;
    case undefined:
        break;
    default:
        throw new InvalidArgumentError('%s is not a valid type',
                                        req.params.type);
    }

    if (req.params.brand) {
        opts.brand = req.params.brand;
    }

    if (req.params.image) {
        opts.image_uuid = req.params.image;
    }

    var docker = req.params.docker;
    if (typeof (docker) === 'boolean') {
        opts.docker = docker;
    }
    if (typeof (docker) === 'string') {
        if (docker === 'true') {
            opts.docker = true;
        } else if (docker === 'false') {
            opts.docker = false;
        } else {
            throw new InvalidArgumentError('%s is not a valid boolean', docker);
        }
    }

    // Not implemented right now into VMAPI
    opts.limit = req.params.limit || 1000;

    if (req.params.memory) {
        opts.ram = req.params.memory;
    }

    if (req.params.name) {
        opts.alias = req.params.name;
    }
    // Not implemented right now into VMAPI
    opts.offset = req.params.offset || 0;

    // Copy in any and all tags.
    Object.keys(req.params).forEach(function (k) {
        if (TAG_RE.test(k)) {
            opts[k] = req.params[k];
        }
    });

    // By default, VMAPI will return everything unless it's told to not
    // retrieve destroyed machines.
    if (!req.params.tombstone && !opts.state) {
        opts.state = 'active';
    }

    return opts;
}


/*
 * Convert the various arguments passed in over HTTP on POST to options which
 * vmapi.createVm() understands.
 */
function getCreateOptions(req) {
    assert.ok(req);

    assert.ok(req.params);
    assert.ok(req.pkg);
    assert.ok(req.dataset);

    var params = req.params;
    var pkg    = req.pkg;
    var img    = req.dataset;

    var brand = img.requirements && img.requirements.brand;
    if (!brand) {
        brand = img.brand || (img.type === 'zvol' ? 'kvm' : 'joyent');
    }

    var opts = {
        'package': pkg.uuid,
        ram: pkg.max_physical_memory,
        brand: brand,
        billing_id: pkg.uuid
    };

    if (pkg.os) {
        opts.os = pkg.os;
    }

    if (pkg.fss) {
        opts.cpu_shares = Math.ceil(pkg.fss);
    }

    if (brand === 'kvm') {
        opts.disks = [
            { image_uuid: img.uuid },
            { size: parseInt(pkg.quota, 10) }
        ];

        // PUBAPI-652: Fixed 10GiB quota for root dataset of all the KVM
        // machines. User data isn't stored in a zone's root dataset, but a
        // separate one.
        opts.quota = 10;
    } else {
        opts.image_uuid = img.uuid;
        opts.image_os   = img.os;
        opts.image_name = img.name;

        if (Number(pkg.quota)) {
            opts.quota = Number(pkg.quota) / 1024;
        }
    }

    var networkUuids = [];

    // Starting in version 7.3, CloudAPI supports what we call interface-
    // centric provisioning. Traditionally, CloudAPI accepted provisioning
    // here in the form of:
    //
    // [ uuid_0, uuid_1, ... ]
    //
    // CloudAPI then translates that format into a form that VMAPI is
    // familiar with. Which is something that looks like:
    //
    // [ { uuid: uuid_0, primary: true }, { uuid: uuid_1 }, ... ]
    //
    // Unlike vmapi, it never supported the form that allows the user to
    // specify an IP or which device was primary. Instead, we have a new
    // form which allows us to request IPs, and will easily evolve into an
    // IPv6-compatible form:
    //
    // [
    //   {
    //     ipv4_uuid: uuid_0, ipv4_count: <number>,
    //     ipv4_ips: [ ip0, ip1, ... ],
    //     ipv6_uuid: uuid_1, ipv6_count: <number>,
    //     ipv6_ips: [ ip0, ip1, ... ],
    //     primary: true
    //   }, ...
    // ]
    //
    // The idea here is that each object is an interface. Interfaces can be
    // IPv4 and IPv6 uuids. That said, we don't quite support everything
    // here yet. We only support a count of 1, or a single IP in the array.
    // We don't support both of those at this time, though we'll go through
    // and support it later on; the same is true for IPv6. The goal is just
    // to future-proof ourselves at the various layers of the stack.
    //
    // Conveniently though, VMAPI supports both forms of this interface.
    // Therefore, if we are in a newer version and we see something that
    // looks like an Object, we'll treat it like this new form, but if we
    // just have arrays of strings, then there's nothing for us to worry
    // worry about, and there's nothing we have to do.
    //
    // If we encounter an API version that's less than 7.3, we end up assuming
    // that it's basically our uuid format, and then move on.

    if (Array.isArray(params.networks)) {

        var ver = req.getVersion();
        var objectsAllowed =
            semver.satisfies('7.3.0', ver) || semver.ltr('7.3.0', ver);
        var ifaceObjects = 0;
        var ifaceStrings = 0;
        var alreadyAdded = {};

        networkUuids = params.networks.filter(function (netObj, idx) {
            var netType = typeof (netObj);
            var netUuid = netObj;

            if (objectsAllowed) {
                switch (netType) {
                    case 'string':
                        ifaceObjects++;
                        break;
                    case 'object':
                        ifaceObjects++;
                        netUuid = netObj.ipv4_uuid;

                        if (typeof (netUuid) !== 'string') {
                            throw new InvalidArgumentError(sprintf(
                                'property "networks[%d].ipv4_uuid": ' +
                                'string expected', idx));
                        }

                        break;
                    default:
                        // the 'property "foo" ...' format intended to match
                        // the json-schema error format:
                        throw new InvalidArgumentError(sprintf(
                            'property "networks[%d]": array of strings or ' +
                            'objects expected', idx));
                }

            } else {
                if (netType !== 'string') {
                    // Match the existing 7.2 behaviour:
                    throw new InvalidArgumentError('Invalid Networks');
                }
            }

            if (alreadyAdded[netUuid]) {
                return false;
            }

            alreadyAdded[netUuid] = true;
            return true;
        });

        if (ifaceObjects.length > 0 && ifaceStrings.length > 0) {
            throw new InvalidArgumentError(
                'property "networks": cannot mix objects and strings');
        }

    } else {
        var pkgNetworks = pkg.networks;

        if (typeof (pkgNetworks) === 'string') {
            try {
                pkgNetworks = JSON.parse(pkgNetworks);
            } catch (e) {
                pkgNetworks = null;
            }
        }

        if (pkgNetworks) {
            networkUuids = pkgNetworks;
        } else {
            // Determine whether to add external and/or internal nics. The
            // user can change which of these are provided, and if they do
            // not, default to external.

            var defaultNetworks = params.default_networks || DEFAULT_NETWORKS;

            if (req.external_nets.length &&
                defaultNetworks.indexOf(EXTERNAL_NIC_TAG) !== -1) {

                networkUuids.push(req.external_nets[0]);
            }

            if (req.internal_nets.length &&
                defaultNetworks.indexOf(INTERNAL_NIC_TAG) !== -1) {

                var internalNet = getInternalNetwork(req);
                if (internalNet) {
                    networkUuids.push(internalNet);
                }
            }
        }
    }

    checkNetworks(req, networkUuids);

    opts.networks = networkUuids;
    if (typeof (networkUuids[0]) === 'object') {
        // We only support ipv4_uuid and ipv4_count for now, so only allow
        // them, just to be safe:
        opts.networks = opts.networks.map(function (n) {
            return {
                ipv4_count: n.ipv4_count || 1,
                ipv4_uuid: n.ipv4_uuid
            };
        });

    } else {
        // Always use the new format for networks ("ipv4_uuid" vs. "uuid"):
        opts.networks = networkUuids.map(function (netUuid) {
            return { ipv4_uuid: netUuid };
        });
    }

    // if we have any external networks, make the first one the primary
    if (req.external_nets.length) {
        for (var i = 0; i !== opts.networks.length; i++) {
            var net = opts.networks[i];

            if (req.external_nets.indexOf(net.ipv4_uuid) !== -1) {
                net.primary = true;
                break;
            }
        }
    }

    if (typeof (params.firewall_enabled) !== 'undefined') {
        opts.firewall_enabled = params.firewall_enabled;
    }

    var metadata = {};
    var shortId;
    var tags = {};

    opts.uuid = uuid();
    shortId = opts.uuid.split(/-/)[0];
    if (params.name) {
        opts.alias = params.name;
    } else {
        opts.alias = shortId;
    }

    // Copy in all the tags and metadata
    Object.keys(params).forEach(function (k) {
        if (TAG_RE.test(k)) {
            tags[k.replace(/^tag\./, '')] = params[k];
        } else if (MD_RE.test(k) && !/_pw$/.test(k)) {
            metadata[k.replace(/^metadata\./, '')] = params[k];
        }
    });

    if (Object.keys(tags).length) {
        opts.tags = JSON.stringify(tags);
    }

    // Windows administrator password:
    if (params.password) {
        metadata.administrator_pw = params.password;
    }

    if (params.administrator_pw) {
        metadata.administrator_pw = params.administrator_pw;
    }

    // root_authorized_keys right place:
    if (req.root_authorized_keys) {
        metadata.root_authorized_keys = req.root_authorized_keys;
    }

    var credentials = metadata.credentials;
    delete metadata.credentials;

    if (typeof (credentials) === 'string') {
        try {
            credentials = JSON.parse(credentials);
        } catch (e) {
            credentials = null;
        }
    }

    if (credentials) {
        // Check users, and ensure we're taking passwords either when they are
        // specified as '<user>_pw' or simply with the respective user names:
        Object.keys(credentials).forEach(function (k) {
            if (!/_pw$/.test(k)) {
                credentials[k + '_pw'] = credentials[k];
                delete credentials[k];
            }
        });

        // Pass a string to VMAPI, not an object, or validation will fail
        opts.internal_metadata = JSON.stringify(credentials);
    }

    if (Object.keys(metadata).length) {
        opts.customer_metadata = JSON.stringify(metadata);
    }

    if (img.disk_driver) {
        opts.disk_driver = img.disk_driver;
    }

    if (img.nic_driver) {
        opts.nic_driver = img.nic_driver;
    }

    // Intentionally not documented, at least until we are checking on
    // vmapi that owner is allowed to specify a given server:
    // PUBAPI-724: Only allow in test mode
    if (params.server_uuid && req.config.test) {
        opts.server_uuid = params.server_uuid;
    }

    // Another alternative to provide server_uuid, (which I mostly use
    // locally to run node-smartdc tests w/o having to hardcode server_uuid
    // into sdc-createmachine):
    if (process.env.SERVER_UUID) {
        opts.server_uuid = process.env.SERVER_UUID;
    }

    if (params.locality) {
        opts.locality = params.locality;
    }

    Object.keys(pkg).forEach(function (p) {
        if (typeof (opts[p]) === 'undefined' &&
            (PKG_USED_PARAMS.indexOf(p) === -1)) {
            opts[p] = pkg[p];
        }
    });

    return opts;
}


/*
 * Return a network object for an internal network, if one is available.
 * Whether the internal network can optionally be a fabric or not is determined
 * by the package name prefix.
 */
function getInternalNetwork(req) {
    assert.ok(req);

    var cfg = req.config;
    var pkg = req.pkg;
    var allNets = req.networks;
    var internalNetUuids = req.internal_nets;

    assert.ok(cfg);
    assert.ok(pkg);
    assert.ok(allNets);
    assert.ok(internalNetUuids);

    if (pkgAllowsFabric(cfg, pkg)) {
        return internalNetUuids[0];
    }

    return internalNetUuids.filter(function (netUuid) {
        var net = getNetwork(allNets, netUuid);
        assert.ok(net);

        return !net.fabric;
    })[0];
}


/*
 * If cloudapi's config lists an array of package name prefixes that can be used
 * with fabrics, and the package used in the current request doesn't have one of
 * those prefixes, check that none of the networks is a fabric.
 *
 * 'networks' arg is an array of UUIDs and hashes
 */
function checkNetworks(req, networks) {
    assert.ok(req);

    var cfg = req.config;
    var pkg = req.pkg;
    var allNets = req.networks;

    assert.ok(cfg);
    assert.ok(pkg);
    assert.ok(allNets);

    if (pkgAllowsFabric(cfg, pkg)) {
        return;
    }

    for (var i = 0; i !== networks.length; i++) {
        var network = networks[i];
        var netUuid = network.ipv4_uuid || network;

        var net = getNetwork(allNets, netUuid);
        if (!net) {
            // if we didn't find a network, it's likely because the user doesn't
            // have permission for that network. We skip this since there are
            // checks elsewhere to ensure such requests are rejected
            continue;
        }

        if (net.fabric) {
            var msg = 'Fabric network cannot be used with this package. Only ' +
                    'packages with names starting with the following can be ' +
                    'used with a fabric network: ' +
                    cfg.fabric_package_prefixes.join(', ');

            var err = new InvalidArgumentError(msg);
            err.body.code = err.restCode = 'InvalidFabricPackage';
            throw err;
        }
    }
}


function getNetwork(networks, netUuid) {
    for (var i = 0; i < networks.length; i++) {
        var net = networks[i];

        if (net.uuid === netUuid) {
            return net;
        }
    }

    return null;
}


/*
 * Check if the current package has a name that matches an allowed prefix. This
 * only applies if cloudapi's config specifies a non-empty array for
 * fabric_package_prefixes.
 */
function pkgAllowsFabric(cfg, pkg) {
    var fabricPkgs = cfg.fabric_package_prefixes;

    if (!fabricPkgs || fabricPkgs.length === 0) {
        return true;
    }

    var canHaveFabric = false;
    fabricPkgs.forEach(function (prefix) {
        canHaveFabric = canHaveFabric || pkg.name.indexOf(prefix) === 0;
    });

    return canHaveFabric;
}


function updateCallback(req, res, next) {
    var log = req.log;

    return function callback(err) {
        if (err) {
            return next(err);
        }

        var m = req.params.machine;
        log.debug('%s (%s/%s): ok', req.action, req.account.login, m);
        res.send(202);
        return next(false);
    };
}


function xorIfPresent(a, b) {
    if (!a && !b) {
        return true;
    }
    return (!a != !b);
}


function loadMachine(req, res, next) {
    var pathname = req.getUrl().pathname;

    if (pathname === '/--ping' || !(/\/machines/.test(pathname))) {
        return next();
    }

    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var name = req.params.machine;

    // set by resources.js, if a PUT with role tags is being done
    if (req.params.resource_name === 'machines' && req.params.resource_id) {
        name = name || req.params.resource_id;
    }

    if (!name) {
        return next();
    }

    var machine;

    return vasync.pipeline({
        funcs: [
            function _getVm(_, cb) {
                req.sdc.vmapi.getVm({
                    uuid: name,
                    owner_uuid: customer,
                    fields: '*'
                }, {
                    log: req.log,
                    headers: {
                        'x-request-id': req.getId()
                    }
                }, function (err, m) {
                    if (err) {
                        return cb(err);
                    }
                    machine = m;
                    return cb(null, m);
                });
            },
            function _getImg(_, cb) {
                if (req.datasets) {
                    return cb(null, req.datasets);
                }

                req.params.image = (machine.image_uuid) ? machine.image_uuid :
                    (machine.brand === 'kvm' && machine.disks[0].image_uuid) ?
                    machine.disks[0].image_uuid : null;

                if (req.params.image === null) {
                    return cb(new ResourceNotFoundError('Cannot find ' +
                        'machine image'));
                }

                return images.loadImage(req, function (err, img) {
                    if (err) {
                        if (err.statusCode && err.statusCode === 404) {
                            // IMGAPI-328: Users can destroy custom images
                            req.datasets = [];
                            return cb(null, req.datasets);
                        }
                        return cb(err);
                    }
                    req.dataset = img;
                    req.log.debug({image: req.dataset},
                        'selected image loaded');
                    req.datasets = [img];
                    return cb(null, req.datasets);
                });
            },
            function _getPkg(_, cb) {
                if (req.packages) {
                    return cb(null, req.packages);
                }

                if (!machine.billing_id) {
                    return cb(new ResourceNotFoundError('Cannot find ' +
                        'machine package'));
                }

                return req.sdc.papi.get(machine.billing_id, {},
                                        function (err, pkg) {
                    if (err) {
                        return cb(err);
                    }
                    req.packages = [pkg];
                    req.log.debug({'package': req.pkg},
                        'selected package loaded');
                    return cb(null, req.packages);
                });
            },
            function _getNetwork(_, cb) {
                loadNetworkUuids(req, machine, function (err, m) {
                    if (err) {
                        return cb(err);
                    }

                    machine = m;

                    return cb();
                });
            },
            function _getCNSNames(_, cb) {
                if (!req.sdc.cns || req.account.triton_cns_enabled !== 'true') {
                    cb();
                    return;
                }
                var opts = {};
                opts.headers = { 'x-request-id': req.getId() };
                req.sdc.cns.getVM(name, opts, function (err, obj) {
                    if (err && err.statusCode === 404) {
                        machine.dns_names = [];
                        return cb();
                    } else if (err) {
                        req.log.error(err,
                            'failed to look up VM %s in CNS REST API', name);
                        var rerr = new InternalError('Unable to contact the ' +
                            'Triton CNS API');
                        return cb(rerr);
                    }
                    machine.dns_names = obj.names;
                    return cb();
                });
            }
        ]
    }, function (err, results) {
        if (err) {
            return next(err);
        }
        req.machine = translate(machine, req);
        if (machine.role_tags && machine.role_tags.length) {
            req.machine_role_tags = machine.role_tags;
        }
        return next();
    });
}


// PUBAPI-943 - some VMs which should have a network_uuid listed in each nic
// do not. When this happens for v7.1+ nics, we fetch the network_uuid directly
// from napi for every nic in the machine.
function loadNetworkUuids(req, machine, cb) {
    var version = req.getVersion();

    if (!machine.nics || machine.nics.length === 0 ||
        machine.state === 'destroyed' ||
        BEFORE_NETWORK_VERSION_RE.test(version)) {

        return cb(null, machine);
    }

    var options = { headers: { 'x-request-id': req.getId() } };
    var napi = req.sdc.napi;

    function getNic(vmapiNic, next) {
        if (vmapiNic.network_uuid) {
            return next();
        }

        return napi.getNic(vmapiNic.mac, options, function (err, napiNic) {
            if (err) {
                return next(err);
            }

            vmapiNic.network_uuid = napiNic.network_uuid;

            return next();
        });
    }

    return vasync.forEachPipeline({
        inputs: machine.nics,
        func: getNic
    }, function (err) {
        return cb(err, machine);
    });
}


// --- Handlers


function imageToDataset(req, res, next) {
    if (!xorIfPresent(req.params.dataset, req.params.image)) {
        return next(new InvalidArgumentError('image and dataset are ' +
                                            'mutually exclusive parameters.'));
    }

    req.params.dataset = req.params.dataset || req.params.image;
    return next();
}


function ensureDataset(req, res, next) {
    if (!req.dataset) {
        if (req.params.dataset) {
            return next(new InvalidArgumentError('%s is not a valid image',
                                                    req.params.dataset));
        }

        return next(new MissingParameterError('image must be specified'));
    }
    // PUBAPI-760:
    if (req.dataset.state !== 'active') {
        return next(new InvalidArgumentError('image %s is not active',
                                                req.params.dataset));
    }
    return next();
}


function ensurePackage(req, res, next) {
    if (!req.pkg) {
        if (req.params['package']) {
            return next(new InvalidArgumentError('%s is not a valid package',
                                                req.params['package']));
        }
        return next(new MissingParameterError('package must be specified'));
    }

    if (!req.pkg.active) {
        return next(new InvalidArgumentError('%s is inactive. ' +
                    'Must use an active package', req.params['package']));
    }

    return next();
}


function checkPassword(req, res, next) {
    // If it's a 'passworded' dataset (i.e. win32), don't look up ssh keys
    if (req.dataset.requirements && req.dataset.requirements.password) {
        if (!req.params.password && !req.params.administrator_pw) {
            return next(new MissingParameterError('%s requires a password',
                                                    req.dataset.uuid));
        }
        req.noKeys = true;
    }

    return next();
}


function loadSSHKeys(req, res, next) {
    assert.ok(req.sdc);

    if (req.noKeys) {
        return next();
    }

    var log = req.log;

    return req.account.listKeys(function (err, keys) {
        if (err) {
            return next(err);
        }

        if (!keys || !keys.length) {
            return next(new KeyRequiredError());
        }

        req.root_authorized_keys = '';
        req.keys = keys;
        keys.forEach(function (k) {
            req.root_authorized_keys += k.openssh + '\n';
        });

        log.debug({
            customer: req.account.uuid,
            root_authorized_keys: req.root_authorized_keys
        }, 'Loaded keys for %s', req.account.login);

        return next();
    });
}

/*
 * This should reflect the same policy CNS uses. It's pretty much an aspect of
 * the public API now, so it can't really be changed.
 */
function dnsify(str) {
    return (str.toLowerCase().replace(/[^a-z0-9-]+/g, '-'));
}

function create(req, res, next) {
    assert.ok(req.sdc);

    var log = req.log;
    var customer = req.account.uuid;
    var login = req.account.login;
    var provisionPermission = req.account.approved_for_provisioning;
    var name = req.params.machine;
    var opts;
    var datasetReqs = req.dataset.requirements;

    if (provisionPermission !== 'true' &&
        !req.config.ignore_approved_for_provisioning_flag) {
        return next(new InvalidArgumentError('User is not currently approved ' +
                    'for provisioning'));
    }

    try {
        opts = getCreateOptions(req);
    } catch (createErr) {
        return next(createErr);
    }

    // PUBAPI-657: Fail early when trying to use a package under image minimum
    // requirements:
    if (datasetReqs && datasetReqs.min_ram && opts.ram < datasetReqs.min_ram) {
        return next(new InvalidArgumentError(sprintf('You must use a ' +
                        'package with at least %d MiB of RAM in order to' +
                        ' provision the selected image',
                        datasetReqs.min_ram)));
    }

    // PUBAPI-726: fail early if the image os and package os differ
    if (opts.os && opts.os !== req.dataset.os) {
        return next(new InvalidArgumentError(sprintf('The package and image ' +
                        'must have the same OS, but package has "%s" while ' +
                        'image has "%s"', req.dataset.os, opts.os)));
    }

    if (opts.alias && req.account.triton_cns_enabled === 'true') {
        /*
         * If using CNS with use_alias=true, then the alias of a zone should
         * be DNS-safe. The max length of a DNS label is 63 chars.
         */
        if (opts.alias.length > 63) {
            return next(new InvalidArgumentError('Name cannot be longer ' +
                'than 63 characters, because you have triton_cns_enabled ' +
                'set on your Account.'));
        }
    }

    // If trying to provision using a network not provisionable by user,
    // fail early instead of queue and wait for the job to do:
    var networkUuids = req.networks.map(function (n) {
        return (n.uuid);
    });

    for (var i = 0; i !== opts.networks.length; i++) {
        if (networkUuids.indexOf(opts.networks[i].ipv4_uuid) === -1) {
            return next(new InvalidArgumentError('Invalid Networks'));
        }
    }

    if (!req.config.allow_multiple_public_networks) {
        // Networks restrictions applied only to public networks
        var externalNetworks = opts.networks.filter(function (net) {
            return req.external_nets.indexOf(net.ipv4_uuid) !== -1;
        });

        var maxNetworks = 1;
        var datasetNetworks = datasetReqs && datasetReqs.networks;

        if (datasetNetworks && datasetNetworks.length > 0) {
            var datasetPublicNetworks = datasetNetworks.filter(function (n) {
                return n.description === 'public';
            });

            maxNetworks = datasetPublicNetworks.length;
        }

        if (externalNetworks.length > maxNetworks) {
            return next(new InvalidArgumentError('Can specify a maximum of ' +
                        maxNetworks + ' public networks'));
        }
    }

    opts.owner_uuid = customer;
    // Audit:
    opts.context = {
        caller: req._auditCtx,
        params: req.params
    };

    var pipeline = [];

    if (req.accountMgmt) {
        if (req.headers['role-tag']) {
            var role_tags = req.headers['role-tag'].split(',');
            pipeline.push(function (_, cb) {
                return membership.preloadGroups(req, role_tags,
                    function (er, roles) {
                    if (er) {
                        req.log.error({
                            err: er,
                            role_tags: req.headers['role-tag']
                        }, 'Error loading roles');
                    } else {
                        opts.role_tags = roles.map(function (r) {
                            return (r.uuid);
                        });
                    }
                    return cb(null);
                });
            });
        } else if (req.activeRoles) {
            pipeline.push(function (_, cb) {
                opts.role_tags = req.activeRoles.map(function (r) {
                    return (r.uuid);
                });
                return cb(null);
            });
        }
    }

    /*
     * If CNS is enabled for this user and nothing already gave us an
     * explicit dns_domain for the new machine, ask CNS for the default
     * DNS suffixes we should use.
     *
     * This lets machines on a CNS-enabled account have their primary DNS
     * FQDN as their system hostname by default, and to resolve other machines
     * on the account in the same DC by their alias/uuid directly.
     */
    if (req.sdc.cns && req.account.triton_cns_enabled === 'true' &&
        !opts.dns_domain) {

        pipeline.push(function (_, cb) {
            var ropts = {};
            ropts.headers = {
                'x-request-id': req.getId(),
                'accept-version': '~1'
            };
            var netUuids = [];
            opts.networks.forEach(function (net) {
                if (net.ipv4_uuid) {
                    netUuids.push(net.ipv4_uuid);
                }
                if (net.ipv6_uuid) {
                    netUuids.push(net.ipv6_uuid);
                }
                if (net.uuid && netUuids.indexOf(net.uuid) === -1) {
                    netUuids.push(net.uuid);
                }
            });
            req.sdc.cns.getSuffixesForVM(opts.owner_uuid, netUuids, ropts,
                function (err, obj) {

                if (err && (err.name === 'NotFoundError' ||
                    err.name === 'ResourceNotFoundError')) {

                    req.log.warn('failed to retrieve DNS suffixes from ' +
                        'CNS REST API because the endpoint is not supported' +
                        ' (have you updated CNS?)');
                    cb();
                    return;
                }

                if (err) {
                    req.log.error(err, 'failed to retrieve DNS suffixes from ' +
                        'CNS REST API');
                    var rerr = new InternalError('Unable to contact the ' +
                        'Triton CNS API');
                    cb(rerr);
                    return;
                }

                /*
                 * VMAPI can only support a single dns_domain value, no list
                 * of search domains can be supplied. So, we just do something
                 * a little nasty here: select the first "instance" suffix and
                 * use only that.
                 */
                var sufs = obj.suffixes.filter(function (suf) {
                    return (suf.indexOf('inst.') === 0);
                });
                if (sufs.length > 0) {
                    opts.dns_domain = sufs[0];
                    /*
                     * Aliases are allowed to have a few characters (eg '_')
                     * that aren't DNS safe (even though we've enforced that
                     * they're the right length since the user has CNS turned
                     * on). So strip them out here the same way CNS will.
                     */
                    opts.hostname = dnsify(opts.alias);
                }
                cb();
            });
        });
    }


    pipeline.push(function (_, cb) {
        return req.sdc.vmapi.createVm(opts, {
            log: req.log,
            headers: {
                'x-request-id': req.getId()
            }
        }, function (err, vm) {
            if (err) {
                // PUBAPI-791: Add some extra information about validation
                // errors for some parameters (and intentionally hide others
                // accepted by vmapi, like server_uuid and similar):
                var body = err.body;
                var msgs = [];
                if (body.code && body.code === 'ValidationFailed' &&
                    body.errors.length) {
                    body.errors.forEach(function (e) {
                        if (e.field === 'alias') {
                            msgs.push('Invalid machine name');
                        } else if ((e.field === 'ram' || e.field === 'quota') &&
                            e.code === 'InsufficientCapacity') {
                            msgs.push('Insufficient capacity in ' +
                                'datacenter to provision machine');
                        } else if (['networks', 'tags', 'customer_metadata',
                            'firewall_enabled'].indexOf(e.field) !== -1) {
                            msgs.push('Invalid ' + e.field);
                        }
                    });
                }

                if (msgs.length) {
                    err.message = err.message + ': ' + msgs.join('. ');
                    err.body.message = err.message;
                }
                return cb(err);
            }

            // FIXME: for SDC7.next do this with backoff module.
            // cloudapi's vmapi client is way faster than moray
            return setTimeout(function () {
                // vm coming from createVM is merely vm_uuid, job_uuid:
                return req.sdc.vmapi.getVm({
                    uuid: vm.vm_uuid,
                    owner_uuid: customer
                }, {
                    log: req.log,
                    headers: {
                        'x-request-id': req.getId()
                    }
                }, function (err1, machine) {
                    if (err1) {
                        return cb(err1);
                    }
                    // PUBAPI-625
                    if (!req.datasets && req.dataset) {
                        req.datasets = [req.dataset];
                    }
                    machine = translate(machine, req);
                    // Cache machine as a res member, so it can be used from
                    // postProvision plugins.
                    res.machine = machine;
                    res.header('Location', sprintf(
                            '/%s/machines/%s', login, machine.id));
                    log.debug('GetMachine(/%s/%s) => %j',
                            customer, name, machine);
                    res.send(201, machine);
                    return cb(null);
                });
            }, 200);
        });

    });

    return vasync.pipeline({
        funcs: pipeline
    }, function (err, results) {
        if (err) {
            return next(err);
        }
        return next();
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);
    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }
    var customer = req.account.uuid;
    var log = req.log;

    try {
        var opts = getListOptions(req);
    } catch (e) {
        if (e.name === 'InvalidArgumentError') {
            return next(e);
        } else {
            throw (e);
        }
    }

    opts.owner_uuid = customer;
    // Advanced search, to allow searching any tagged machine (note this
    // overrides any other option):
    if (req.params.tags && req.params.tags === '*') {
        opts = {
            query: '(&(owner_uuid=' + customer + ')(tags=*))'
        };
    }

    function addNetworks(machine, cb) {
        loadNetworkUuids(req, machine, cb);
    }

    return req.sdc.vmapi.listVms(opts, {
        log: req.log,
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, machines) {
        if (err) {
            return next(err);
        }

        return vasync.forEachPipeline({
            inputs: machines,
            func: addNetworks
        }, function (err2) {
            if (err2) {
                return next(err2);
            }

            // NB: machines was mutated by the addNetworks() calls
            var translated = machines.map(function (m) {
                return translate(m, req);
            });

            log.debug('ListMachines(%s) => %j', customer, translated);

            res.header('x-query-limit', opts.limit);
            res.header('x-resource-count', translated.length);
            res.send(translated);

            return next();
        });
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);
    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }
    var customer = req.account.uuid,
        log = req.log,
        name = req.params.machine;
    // Already preloaded by loadMachine:
    log.debug('GetMachine(%s/%s) => %j', customer, name, req.machine);
    res.send((req.machine.state === 'deleted' ? 410 : 200), req.machine);
    return next();
}


function start(req, res, next) {
    if (req.params.action !== 'start') {
        return next();
    }

    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
        return next();
    }

    return req.sdc.vmapi.startVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid,
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid,
        // Audit:
        context: {
            caller: req._auditCtx,
            params: req.params
        }
    }, {
        log: req.log,
        headers: {
            'x-request-id': req.getId()
        }
    }, updateCallback(req, res, next));
}


function stop(req, res, next) {
    if (req.params.action !== 'stop') {
        return next();
    }

    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
        return next();
    }

    return req.sdc.vmapi.stopVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid,
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid,
        // Audit:
        context: {
            caller: req._auditCtx,
            params: req.params
        }
    }, {
        log: req.log,
        headers: {
            'x-request-id': req.getId()
        }
    }, updateCallback(req, res, next));
}


function reboot(req, res, next) {
    if (req.params.action !== 'reboot') {
        return next();
    }

    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
        return next();
    }

    return req.sdc.vmapi.rebootVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid,
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid,
        // Audit:
        context: {
            caller: req._auditCtx,
            params: req.params
        }
    }, {
        log: req.log,
        headers: {
            'x-request-id': req.getId()
        }
    }, updateCallback(req, res, next));
}


function resize(req, res, next) {
    if (req.params.action !== 'resize') {
        return next();
    }

    if (req.machine.state === 'deleted') {
        // the docker attr is only available for the resize action, but we don't
        // want to expose it to over the API
        delete req.machine.docker;
        res.send(410, req.machine);
        return next();
    }

    // Some of the checks here are done redundantly by vmapi as well. However,
    // it probably doesn't hurt (too much) to have redundant checks, since we're
    // facing the Internet. Bugs happen; best fail closed.

    // KVM resize is not supported at the moment. VMAPI will move to return this
    // error synchronously instead
    if (req.machine.type === 'virtualmachine') {
        return next(new InvalidArgumentError('resize is not supported for ' +
            'KVM virtualmachines'));
    }

    // Don't let the user resize to the default
    if (!req.pkg) {
        if (req.params['package']) {
            return next(new InvalidArgumentError('%s is not a valid package',
                                                    req.params['package']));
        }
        return next(new MissingParameterError('package must be specified'));
    }

    if (!req.pkg.active) {
        return next(new InvalidArgumentError('%s is inactive. ' +
                    'Must use an active package', req.params['package']));
    }

    var imgReq = req.dataset.requirements;
    var pkgRam = req.pkg.max_physical_memory;

    if (imgReq && imgReq.min_ram > pkgRam) {
        return next(new InvalidArgumentError(
                    'Package RAM (%s) is less than allowed by the image (%s)',
                    pkgRam, imgReq.min_ram));
    }

    if (imgReq && imgReq.max_ram < pkgRam) {
        return next(new InvalidArgumentError(
                    'Package RAM (%s) is more than allowed by the image (%s)',
                    pkgRam, imgReq.max_ram));
    }

    var callback = updateCallback(req, res, next),
        params = {
            uuid: req.params.machine,
            owner_uuid: req.account.uuid,
            origin: req.params.origin || 'cloudapi',
            creator_uuid: req.account.uuid,
            payload: {
                'package': req.pkg.uuid,
                max_physical_memory: pkgRam,
                ram: pkgRam,
                max_swap: req.pkg.max_swap,
                quota: Math.ceil(Number(req.pkg.quota) / 1024),
                cpu_cap: req.pkg.cpu_cap,
                max_lwps: req.pkg.max_lwps,
                zfs_io_priority: req.pkg.zfs_io_priority,
                vcpus: req.pkg.vcpus,
                billing_id: req.pkg.uuid
            }
        };

    // PUBAPI-444: Trying to figure out where do we have the missing resize
    // params happening just some times, found it was due to missing package
    // on random cases. If we don't have a package to resize loaded, we rather
    // fail early.
    req.log.info({
        request_params: req.params,
        req_pkg: req.pkg,
        params: params
    }, 'updateVm resize params');

    if (!req.pkg) {
        return next(new InternalError('Unable to load the requested package'));
    }
    // Audit:
    params.context = {
        caller: req._auditCtx,
        params: req.params
    };
    return req.sdc.vmapi.updateVm(params, {
        log: req.log,
        headers: {
            'x-request-id': req.getId()
        }
    }, callback);
}


function rename(req, res, next) {
    if (req.params.action !== 'rename') {
        return next();
    }

    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
        return next();
    }

    if (!req.params.name) {
        return next(new MissingParameterError('New name must be specified'));
    }

    /*
     * Max length of name is 255 chars, after base64 encoding (3:4), so
     * raw length is  floor( 255 / 4 ) * 3 = 189
     */
    if (req.params.name.length > 189) {
        return next(new InvalidArgumentError('Name cannot be longer than ' +
            '189 characters.'));
    }

    if (req.account.triton_cns_enabled === 'true') {
        if (req.params.name.length > 63) {
            return next(new InvalidArgumentError('Name cannot be ' +
                'longer than 63 characters, because you have ' +
                'triton_cns_enabled set on your Account.'));
        }
    }

    return req.sdc.vmapi.updateVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid,
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid,
        // Audit:
        context: {
            caller: req._auditCtx,
            params: req.params
        },
        payload: {
            alias: req.params.name
        }
    }, {
        log: req.log,
        headers: {
            'x-request-id': req.getId()
        }
    }, updateCallback(req, res, next));
}


function enable_firewall(req, res, next) {
    if (req.params.action !== 'enable_firewall') {
        return next();
    }

    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
        return next();
    }

    // No need to queue a job if it's already enabled
    if (req.machine.firewall_enabled === true) {
        res.send(202);
        return next(false);
    }

    return req.sdc.vmapi.updateVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid,
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid,
        payload: {
            firewall_enabled: true
        },
        // Audit:
        context: {
            caller: req._auditCtx,
            params: req.params
        }
    }, {
        log: req.log,
        headers: {
            'x-request-id': req.getId()
        }
    }, updateCallback(req, res, next));
}


function disable_firewall(req, res, next) {
    if (req.params.action !== 'disable_firewall') {
        return next();
    }

    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
        return next();
    }

    // No need to queue a job if it's already enabled
    if (req.machine.firewall_enabled === false) {
        res.send(202);
        return next(false);
    }

    return req.sdc.vmapi.updateVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid,
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid,
        payload: {
            firewall_enabled: false
        },
        // Audit:
        context: {
            caller: req._auditCtx,
            params: req.params
        }
    }, {
        log: req.log,
        headers: {
            'x-request-id': req.getId()
        }
    }, updateCallback(req, res, next));
}



function del(req, res, next) {
    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
        return next();
    }

    var customer = req.account.uuid;
    var machine = req.params.machine;
    var log = req.log;
    var vmapi = req.sdc.vmapi;

    return vmapi.listJobs({
        vm_uuid: machine,
        owner_uuid: customer,
        task: 'destroy'
    }, {
        log: req.log,
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, jobs) {
        if (err) {
            return next(err);
        }

        var execution = jobs[0] && jobs[0].execution;

        if (execution === 'succeeded') {
            res.send(410, machine);
            return next();
        }

        if (execution === 'running') {
            res.send(204);
            return next();
        }

        return vmapi.deleteVm({
            uuid: machine,
            owner_uuid: customer,
            origin: req.params.origin || 'cloudapi',
            creator_uuid: customer,
            // Audit:
            context: {
                caller: req._auditCtx,
                params: req.params
            }
        }, {
            log: req.log,
            headers: {
                'x-request-id': req.getId()
            }
        }, function (err2) {
            if (err2) {
                return next(err2);
            }

            log.debug('rm %s/%s successful', req.account.login, machine);
            res.send(204);
            return next();
        });
    });




}


function getRuleMachines(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var id = req.params.id;
    var fwapi = req.sdc.fwapi;

    function addNetworks(machine, cb) {
        loadNetworkUuids(req, machine, cb);
    }

    return fwapi.getRuleVMs(id, {
        owner_uuid: customer
    }, function (err, machines) {
        if (err) {
            return next(err);
        }

        return vasync.forEachPipeline({
            inputs: machines,
            func: addNetworks
        }, function (err2) {
            if (err2) {
                return next(err2);
            }

            // NB: machines was mutated by the addNetworks() calls
            var translated = machines.map(function (m) {
                return translate(m, req);
            });

            log.debug('GET %s => %j', req.path(), translated);

            res.header('x-resource-count', translated.length);
            res.send(translated);

            return next();
        });
    });
}


/**
 * Note @param {Array} pre and @param {Array} post can be
 * undefined when there aren't pre or post provision hooks enabled for the
 * configured plugins.
 */
function mount(server, before, pre, post) {
    assert.object(server);
    assert.ok(before);

    server.post(
        {
            path: '/:account/machines',
            name: 'CreateMachine'
        },
        before,
        pre || [],
        imageToDataset,
        ensureDataset,
        ensurePackage,
        checkPassword,
        loadSSHKeys,
        create,
        post || []);

    // The update handlers all check "should I run?" and if they should,
    // the chain stops.  To handle the case where the user specified a bogus
    // action
    server.post(
        {
            path: '/:account/machines/:machine',
            name: 'UpdateMachine',
            version: ['7.0.0', '7.1.0', '7.2.0', '7.3.0', '8.0.0']
        },
        before,
        rename,
        start,
        stop,
        reboot,
        resize,
        enable_firewall,
        disable_firewall,
        function invalidAction7(req, res, next) {
            if (req.params.action) {
                return next(new InvalidArgumentError('%s is not a valid action',
                                                        req.params.action));
            }

            return next(new MissingParameterError('action is required'));
        });

    server.get(
        {
            path: '/:account/machines',
            name: 'ListMachines'
        },
        before,
        imageToDataset,
        list);

    server.head(
        {
            path: '/:account/machines',
            name: 'HeadMachines'
        },
        before,
        imageToDataset,
        list);


    server.get({
        path: '/:account/fwrules/:id/machines',
        name: 'ListFirewallRuleMachines'
    }, before, getRuleMachines);

    server.head({
        path: '/:account/fwrules/:id/machines',
        name: 'HeadFirewallRuleMachines'
    }, before, getRuleMachines);

    server.get(
        {
            path: '/:account/machines/:machine',
            name: 'GetMachine'
        },
        before,
        get);

    server.head(
        {
            path: '/:account/machines/:machine',
            name: 'HeadMachine'
        },
        before,
        get);

    server.del(
        {
            path: '/:account/machines/:machine',
            name: 'DeleteMachine'
        },
        before,
        del);

    return server;
}


///--- Exports

module.exports = {
    mount: mount,
    loadMachine: loadMachine
};
