/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');

function _objectHasSameValueForProperty(value, propertyName, object) {
    return object[propertyName] === value;
}

function checkFabricNetworks(napiClient, networks, accountUuid, callback) {
    assert.object(napiClient, 'napiClient');
    assert.arrayOfUuid(networks, 'networks');
    assert.uuid(accountUuid, 'accountUuid');
    assert.func(callback, 'callback');

    var listNetworkParams = {
        owner_uuid: accountUuid,
        fabric: true
    };

    /*
     * We consider that, in an empty list of networks, all networks are fabric
     * networks.
     */
    if (networks.length === 0) {
        callback(null, true);
        return;
    }

    napiClient.listNetworks(listNetworkParams,
        function onListFabricNetworks(listNetworksErr, actualFabricNetworks) {
            var allNetworksFabricNetworks = false;
            var notFabricNetworks;
            var i;

            if (listNetworksErr) {
                callback(listNetworksErr, false);
                return;
            }

            notFabricNetworks = [];
            for (i = 0; i < networks.length; ++i) {
                var candidateFabricNetwork = networks[i];
                var objectWithCandidateUuid =
                    _objectHasSameValueForProperty.bind(candidateFabricNetwork,
                        'uuid');

                if (actualFabricNetworks.find(objectWithCandidateUuid) ===
                    undefined) {
                    notFabricNetworks.push(candidateFabricNetwork);
                }
            }

            if (notFabricNetworks.length === 0) {
                allNetworksFabricNetworks = true;
            }

            callback(null, allNetworksFabricNetworks);
        });
}

function getDefaultFabricNetworkForUser(ufdsClient, dataCenterName, userUuid,
    callback) {
    assert.object(ufdsClient, 'ufdsClient');
    assert.string(dataCenterName, 'dataCenterName');
    assert.uuid(userUuid, 'userUuid');
    assert.func(callback, 'callback');

    ufdsClient.getDcLocalConfig(userUuid, dataCenterName,
        function onGetDcLocalConfig(getDcLocalConfigErr, conf) {
            if (getDcLocalConfigErr) {
                callback(getDcLocalConfigErr);
                return;
            }

            if (!conf || !conf.defaultnetwork) {
                callback(new Error('Could not get default network'));
                return;
            }

            callback(null, {uuid: conf.defaultnetwork});
        });
}

function getNicTagsFromConfig(config) {
    assert.object(config, 'config');

    return {
        admin: config.admin_nic_tag,
        external: config.external_nic_tag,
        internal: config.internal_nic_tag
    };
}

module.exports = {
    checkFabricNetworks: checkFabricNetworks,
    getDefaultFabricNetworkForUser: getDefaultFabricNetworkForUser,
    getNicTagsFromConfig: getNicTagsFromConfig
};