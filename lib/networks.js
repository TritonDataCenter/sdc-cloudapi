/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');

var modConfig = require('./config');

var ADMIN_NIC_TAG = 'admin';
var EXTERNAL_NIC_TAG = 'external';
var INTERNAL_NIC_TAG = 'internal';

/*
 * Check if a network or pool is named or tagged with the following nictag
 * accounting for rack aware nictag format of "<tag>_rack_<rack id>".
 */
function _isNetCommon(net, tag) {
    if (net.name === tag) {
        return true;
    }

    var rackTag = new RegExp('^' + tag + '_rack_[a-z0-9_-]+$', 'i');

    if (net.nic_tag === tag || net.nic_tag.search(rackTag) === 0) {
        return true;
    }

    /* Is this a network pool? */
    if (net.nic_tags_present) {
        var tagsLen = net.nic_tags_present.length;

        if (net.nic_tags_present.indexOf(tag) !== -1) {
            return true;
        }

        /*
         * We could start at i = 1 here because in the case of network pools
         * the nic_tag property is set to the first element of the
         * nic_tags_provided array.  But that is some what of an obsecure
         * assumption that could change in the future.
         */
        for (var i = 0; i < tagsLen; i++) {
            if (net.nic_tags_present[i].search(rackTag) === 0) {
                return true;
            }
        }
    }

    return false;
}

function checkFabricNetworks(napiClient, networks, accountUuid, cb) {
    assert.object(napiClient, 'napiClient');
    assert.arrayOfUuid(networks, 'networks');
    assert.uuid(accountUuid, 'accountUuid');
    assert.func(cb, 'cb');

    var listNetworkParams = {
        owner_uuid: accountUuid,
        fabric: true
    };

    /*
     * We consider that, in an empty list of networks, all networks are fabric
     * networks.
     */
    if (networks.length === 0) {
        return cb(null, true);
    }

    return napiClient.listNetworks(listNetworkParams,
        function onListFabricNetworks(listNetworksErr, actualFabricNetworks) {
            var fabricNetworkUuids = [];
            var i;

            if (listNetworksErr) {
                return cb(listNetworksErr, false);

            }

            assert.arrayOfObject(actualFabricNetworks, 'actualFabricNetworks');

            // pull out just the UUIDs, so fabricNetworkUuids will be an array
            // of just uuids of the fabric networks.
            fabricNetworkUuids = actualFabricNetworks.map(
                function mapUuids(network) {
                    return network.uuid;
                });

            //
            // Loop through all networks, if the network is found in
            // fabricNetworkUuids (meaning: it's a fabric network) keep going.
            // If it's not a fabric network, call:
            //
            //     cb(null, false);
            //
            // to indicate that some networks passed were not fabric networks.
            // If we get to the end of the list and haven't found any non-fabric
            // networks, call:
            //
            //     cb(null, true);
            //
            for (i = 0; i < networks.length; ++i) {
                if (fabricNetworkUuids.indexOf(networks[i]) === -1) {
                    // networks[i] does not exist in fabricNetworkUuids, so
                    // at least one of the networks passed was non-fabric.
                    return cb(null, false);
                }
            }

            // All networks passed were fabric networks.
            return cb(null, true);
        });
}

function getDefaultFabricNetworkForUser(ufdsClient, dataCenterName, account,
    options, cb) {
    assert.object(ufdsClient, 'ufdsClient');
    assert.string(dataCenterName, 'dataCenterName');
    assert.object(account, 'account');
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');
    assert.func(cb, 'cb');

    modConfig.getAccountDcConfigFromUFDS(ufdsClient, account, dataCenterName, {
        log: options.log
    },  function onGetDcLocalConfig(getDcLocalConfigErr, conf) {
        if (getDcLocalConfigErr) {
            cb(getDcLocalConfigErr);
            return;
        }
        options.log.info({conf: conf}, 'config');

        if (!conf || !conf.defaultnetwork) {
            cb(new Error('Could not get default network'));
            return;
        }

        cb(null, {uuid: conf.defaultnetwork});
    });
}

function isAdmin(net) {
    return _isNetCommon(net, ADMIN_NIC_TAG);
}

function isExternal(net) {
    return _isNetCommon(net, EXTERNAL_NIC_TAG);
}

function isInternal(net) {
    return _isNetCommon(net, INTERNAL_NIC_TAG);
}


module.exports = {
    ADMIN_NIC_TAG: ADMIN_NIC_TAG,
    checkFabricNetworks: checkFabricNetworks,
    EXTERNAL_NIC_TAG: EXTERNAL_NIC_TAG,
    getDefaultFabricNetworkForUser: getDefaultFabricNetworkForUser,
    INTERNAL_NIC_TAG: INTERNAL_NIC_TAG,
    isAdmin: isAdmin,
    isExternal: isExternal,
    isInternal: isInternal
};
