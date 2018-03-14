/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Forces specific accounts to only use networks or network pools which belong
 * to that account. Specifically, it prevents creating VMs with anything other
 * than networks or pools belonging to that account, or adding NICs which can
 * access same. It also applies the same rules to the listing of networks (i.e.
 * GET /:account/networks) to reduce surprises to cloudapi clients.
 *
 * Each network or pool has an optional array of UUIDs associated with users.
 * When adding a NIC to a VM, we check that the UUID of the current account
 * matches any of the UUIDs in the requested network or pool's owner_uuids
 * array. If not, it is rejected.
 *
 * Provisioning of a VM is similar in principle, with the complication of
 * package networks and default_networks. If a params.networks is provided, we
 * check that every one of those network or poolss contains the current
 * account's UUID in their owner_uuids array. If params.networks isn't provided,
 * we check whether all networks or pools listed by the package are owned by the
 * account. If the package * doesn't have any network or pools listed, then we
 * lastly move on to params.default_networks and fill in params.networks
 * ourselves, to disable cloudapi doing its own default filtering (which has
 * looser filtering, by allowing DC-shared non-owned network and pools to also
 * be used). For default_networks, we again only allow the use of external and
 * internal networks/pools that belong to the owner.
 *
 * Note that non-owner_uuid networks which are members of a pool which includes
 * the account UUID in the pool's owner_uuids will be included. This code
 * assumes that if an account is included in a pool's owner_uuids, that all
 * network members of that pool are eligible for use.
 *
 * One significant pitfall to be aware of is that this plugin partially
 * replicated some of cloudapi's behaviours, plus it depends on certain others.
 * Any major changes to these behaviours by cloudapi might either break this
 * plugin, or cause the plugin to hide newer changes to cloudapi.
 */


var assert = require('assert-plus');
var restify = require('restify');

var InvalidArgumentError = restify.InvalidArgumentError;

// same as in lib/networks.js and lib/machines.js
var EXTERNAL_NIC_TAG = 'external';
var INTERNAL_NIC_TAG = 'internal';
var DEFAULT_NETWORKS = [EXTERNAL_NIC_TAG, INTERNAL_NIC_TAG];


/*
 * Return all networks which include ownerUuid inside their owner_uuids
 * attribute.
 */
function getOwnedNetworks(networks, ownerUuid) {
    assert.arrayOfObject(networks, 'networks');
    assert.uuid(ownerUuid, 'ownerUuid');

    return networks.filter(function filterOwner(network) {
        var owners = network.owner_uuids;
        return owners && owners.indexOf(ownerUuid) !== -1;
    });
}


/*
 * Returns either external (has public IPs) or internal (has private or DC-only
 * IPs) networks, depending on netType arg. NB: internal networks are defined
 * here to include fabrics.
 */
function filterNetworkType(networks, netType) {
    assert.arrayOfObject(networks, 'networks');
    assert.string(netType, 'netType');

    if (netType === EXTERNAL_NIC_TAG) {
        return networks.filter(function externalFilter(network) {
            return !network.fabric && network.nic_tag === EXTERNAL_NIC_TAG;
        });
    } else {
        return networks.filter(function internalFilter(network) {
            return network.fabric || network.nic_tag !== EXTERNAL_NIC_TAG;
        });
    }
}


/*
 * Take an array of network objects and return an array of their UUIDs.
 */
function getNetworkUuids(networks) {
    assert.arrayOfObject(networks, 'networks');

    return networks.map(function mapUuids(network) {
        return network.uuid;
    });
}


/*
 * Return boolean of whether arr1 is a subset of arr2. Only works
 * with arrays of primitive types.
 */
function isSubset(arr1, arr2) {
    for (var i = 0; i < arr1.length; i++) {
        var ele = arr1[i];

        if (arr2.indexOf(ele) === -1) {
            return false;
        }
    }

    return true;
}


/*
 * The prelude is run at the beginning of all pre/post functions in this file.
 * It checks that required arguments are present, and whether the pre/post
 * function should be terminated early -- returned as a boolean.
 */
function prelude(req, res, cfg, funcName, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.object(cfg, 'cfg');
    assert.string(funcName, 'funcName');
    assert.func(next, 'next');

    req.log.debug('Running ' + funcName);

    if (cfg.accounts.indexOf(req.account.uuid) === -1) {
        return false;
    }

    var path = req.path();
    var method = req.method;

    return ((method ===  'GET' && /^\/[^\/]+\/networks$/.test(path)) ||
            (method === 'POST' && /\/(?:machines|nics)$/.test(path)));
}


/*
 * Hook for preprovisioning. Ensure that all networks given in params or
 * packages the request's account in their owner_uuids attribute. If
 * neither are provided, then filter the default external/internal networks
 * for networks which fulfill the owner_uuids requirement.
 */
function preProvision(cfg) {
    assert.object(cfg, 'cfg');
    assert.arrayOfUuid(cfg.accounts, 'cfg.accounts');

    return function filterOwnerProvision(req, res, next) {
        if (!prelude(req, res, cfg, filterOwnerProvision.name, next)) {
            return next();
        }

        var log = req.log;
        var params = req.params;
        var ownedNetworks = getOwnedNetworks(req.networks, req.account.uuid);
        var ownedNetworkUuids = getNetworkUuids(ownedNetworks);
        var reqNetworkUuids = params.networks;
        var pkgNetworkUuids = req.pkg && req.pkg.networks;

        if (reqNetworkUuids) {
            log.debug('Comparing requested networks with owned networks');

            if (!isSubset(reqNetworkUuids, ownedNetworkUuids)) {
                return next(new InvalidArgumentError('Account does not have ' +
                    'access to some or all of the requested networks.'));
            }
        } else if (pkgNetworkUuids) {
            log.debug('Comparing package networks with owned networks');

            if (!isSubset(pkgNetworkUuids, ownedNetworkUuids)) {
                return next(new InvalidArgumentError('Account does not have ' +
                    'access to some or all of the package networks.'));
            }
        } else {
            log.debug('Allowing only owned networks in internal/external.');

            var defaultNetTypes = params.default_networks || DEFAULT_NETWORKS;
            if (!Array.isArray(defaultNetTypes)) {
                return next(new InvalidArgumentError('default_networks is ' +
                    'not an array'));
            }

            var filteredNetworks = [];
            defaultNetTypes.forEach(function (type) {
                var nets = filterNetworkType(ownedNetworks, type);
                if (nets.length > 0) {
                    filteredNetworks.push(nets[0]);
                }
            });

            if (filteredNetworks.length === 0) {
                return next(new InvalidArgumentError('Account does not have ' +
                    'ownership of any default networks'));
            }

            log.info('Plugin rewrite of req.params.networks using',
                defaultNetTypes);
            params.networks = getNetworkUuids(filteredNetworks);
        }

        return next();
    };
}


/*
 * Hook run before adding a nic to a VM. Ensure that network given in network
 * param contains the request's account in its owner_uuids attribute.
 */
function preAddNic(cfg) {
    assert.object(cfg, 'cfg');
    assert.arrayOfUuid(cfg.accounts, 'cfg.accounts');

    return function filterOwnerAddNic(req, res, next) {
        if (!prelude(req, res, cfg, filterOwnerAddNic.name, next)) {
            return next();
        }

        var networkUuid = req.params.network;
        if (!networkUuid) {
            return next();
        }

        req.log.debug('Comparing requested network with owned networks');

        var ownedNetworks = getOwnedNetworks(req.networks, req.account.uuid);
        var ownedNetworkUuids = getNetworkUuids(ownedNetworks);

        if (ownedNetworkUuids.indexOf(networkUuid) === -1) {
            return next(new InvalidArgumentError(
                'Account does not have access to the specified network.'));
        }

        return next();
    };
}



/*
 * This hook runs before the listing of non-fabric networks, and filters
 * req.networks (set earlier by cloudapi) so that it only contains networks
 * or network pools which have the account UUID in their owner_uuids.
 */
function preListNetworks(cfg) {
    assert.object(cfg, 'cfg');
    assert.arrayOfUuid(cfg.accounts, 'cfg.accounts');

    return function filterOwnerListNetworks(req, res, next) {
        if (!prelude(req, res, cfg, filterOwnerListNetworks.name, next)) {
            return next();
        }

        req.log.info('Plugin rewrite of req.networks');
        req.networks = getOwnedNetworks(req.networks, req.account.uuid);

        return next();
    };
}


module.exports = {
    preProvision: preProvision,
    preAddNic: preAddNic,
    preListNetworks: preListNetworks
};
