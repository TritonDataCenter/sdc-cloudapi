/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var assert = require('assert-plus');
var restify = require('restify');

var InvalidArgumentError = restify.InvalidArgumentError;
var MissingParameterError = restify.MissingParameterError;
var ResourceNotFoundError = restify.ResourceNotFoundError;

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateNetworkObject(netObj, networks) {
    assert.object(netObj, 'netObj');
    assert.arrayOfObject(networks, 'networks');

    var ipv4_uuid = netObj.ipv4_uuid;
    var ipv4_ips = netObj.ipv4_ips;
    var ipv4_count = netObj.ipv4_count;

    if (!ipv4_uuid) {
        return new MissingParameterError('network objects must contain' +
            ' ipv4_uuid');
    }

    if (typeof (ipv4_uuid) !== 'string') {
        return new InvalidArgumentError('ipv4_uuid must be a string');
    }

    if (!ipv4_uuid.match(UUID_RE)) {
        return new InvalidArgumentError('ipv4_uuid: %s is not a uuid',
            ipv4_uuid);
    }

    if (ipv4_count !== undefined && ipv4_ips !== undefined) {
        return new InvalidArgumentError('ipv4_count and ipv4_ips cannot be' +
            ' specified together');
    }

    if (ipv4_count !== undefined) {
        if (typeof (ipv4_count) !== 'number') {
            return new InvalidArgumentError('ipv4_count must be a number');
        }

        if (ipv4_count !== 1) {
            return new InvalidArgumentError('ipv4_count can only be set to 1');
        }
    }

    if (ipv4_ips !== undefined) {
        if (!Array.isArray(ipv4_ips)) {
            return new InvalidArgumentError('ipv4_ips must be an array with a' +
                ' single IP');
        }

        if (ipv4_ips.length !== 1) {
            return new InvalidArgumentError('ipv4_ips: network with' +
                ' ipv4_uuid %s should contain a single IP' +
                ' array', ipv4_uuid);
        }

        if (typeof (ipv4_ips[0]) !== 'string') {
            return new InvalidArgumentError('ipv4_ips[0]: string expected');
        }

        /*
         * We need to verify the following up front:
         * - The network is within the users networks
         * - The network is not a pool
         * - The network is not public
         */
        var net = networks.find(
            function checkForNetwork(n) {
            return n.uuid === ipv4_uuid;
        });

        if (!net) {
            return new ResourceNotFoundError('ipv4_uuid: network %s not found',
                ipv4_uuid);
        }

        if (Array.isArray(net.networks)) {
            return new InvalidArgumentError('ipv4_uuid: %s cannot' +
                ' specify IP on a network pool', ipv4_uuid);
        }

        if (!net.hasOwnProperty('owner_uuids')) {
            return new InvalidArgumentError('ipv4_uuid: %s cannot' +
                ' specify IP on a public network', ipv4_uuid);
        }
    }

    return null;
}


module.exports = {
    validateNetworkObject: validateNetworkObject
};
