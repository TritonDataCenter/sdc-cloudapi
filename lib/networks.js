/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

var assert = require('assert-plus');

var modConfig = require('./config');

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


module.exports = {
    checkFabricNetworks: checkFabricNetworks,
    getDefaultFabricNetworkForUser: getDefaultFabricNetworkForUser
};
