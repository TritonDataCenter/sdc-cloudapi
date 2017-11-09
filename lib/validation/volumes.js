/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var restify = require('restify');

/*
 * Volume name search param is special because we allow '*' as a prefix or
 * suffix for wildcard searching. As such, we need to validate that the name is
 * valid whether or not it is surrounded by '*'s.
 */
var VALID_VOLUME_NAME_SEARCH_PARAM_REGEXP = /^\*?[\w\.\-]+\*?$/i;
var VALID_VOLUME_NAME_REGEXP = /^[a-z0-9][\w\.\-]+$/i;
var VALID_VOLUME_SIZE_REGEXP = /^[1-9][0-9]*$/;
var VALID_VOLUME_TYPES = ['tritonnfs'];
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function validateVolumeId(volumeId) {
    var err;

    if (!UUID_RE.test(volumeId)) {
        err = new Error('Invalid volume ID: ' + volumeId + '. Volume ' +
            'ID should match ' + UUID_RE);
    }

    return err;
}

function validateVolumeName(volumeName, opts) {
    var allowEmptyVolName = opts && opts.allowEmpty;
    var err;
    var validVolumeName;

    assert.optionalObject(opts, 'opts');
    if (opts) {
        assert.bool(opts.allowEmpty, 'opts.allowEmpty');
    }

    // Some actions allow non-existent names (empty or undefined), if
    // opts.allowEmpty is truthy, we'll accept a missing name or empty string
    // as valid.
    if (allowEmptyVolName && (volumeName === undefined || volumeName === '')) {
        validVolumeName = true;
    } else {
        validVolumeName = VALID_VOLUME_NAME_REGEXP.test(volumeName);
    }

    if (!validVolumeName) {
        err = new Error('Invalid volume name: ' + volumeName + '. Volume ' +
            'name should match ' + VALID_VOLUME_NAME_REGEXP);
    }

    return err;
}

function validateVolumeNameSearchParam(name) {
    var err;

    if (!VALID_VOLUME_NAME_SEARCH_PARAM_REGEXP.test(name)) {
        err = new Error('invalid value for name search parameter');
    }

    return err;
}

function validateVolumeType(volumeType) {
    var err;
    var validVolumeType = typeof (volumeType) === 'string' &&
        VALID_VOLUME_TYPES.indexOf(volumeType) !== -1;

    if (!validVolumeType) {
        err = new Error('Invalid volume type: ' + volumeType + '. Volume ' +
            'type should be one of: ' + VALID_VOLUME_TYPES.join(', '));
    }

    return err;
}

function validateVolumeSize(volumeSize) {
    var err;
    var validVolumeSize = typeof (volumeSize) === 'number' && volumeSize > 0;

    if (!validVolumeSize) {
        err = new Error('Invalid volume size: ' + volumeSize);
    }

    return err;
}

// NOTE: This duplicates code from sdc-volapi's lib/validation/volumes.js and
//       should probably eventually be put in a library shared between the two.
function validateVolumeSizeSearchParam(size) {
    var err;

    assert.optionalString(size, 'size');

    if (!VALID_VOLUME_SIZE_REGEXP.test(size)) {
        err = new Error('invalid value for size search parameter, must match '
            + VALID_VOLUME_SIZE_REGEXP.toString());
    }

    return err;
}

function validateVolumeNetwork(volumeNetwork) {
    var err;

    if (!UUID_RE.test(volumeNetwork)) {
        err = new Error('Invalid volume network: ' + volumeNetwork);
    }

    return err;
}

function validateVolumeNetworks(volumeNetworks) {
    var err;
    var volumeNetworksValid = false;

    if (volumeNetworks === undefined) {
        volumeNetworksValid = true;
    } else {
        if (Array.isArray(volumeNetworks)) {
            volumeNetworksValid =
                volumeNetworks.every(function checkNetworkValidity(network) {
                    return validateVolumeNetwork(network) === undefined;
                });
        }
    }

    if (!volumeNetworksValid) {
        err = new Error('Invalid networks: ' + volumeNetworks);
    }

    return err;
}

function validateVolumeState(state) {
    var VALID_STATES = ['creating', 'ready', 'failed', 'deleting'];
    var err;

    if (VALID_STATES.indexOf(state) === -1) {
        err = new Error('Volume state: ' + state + ' is invalid');
    }

    return err;
}

module.exports = {
    validateVolumeId: validateVolumeId,
    validateVolumeName: validateVolumeName,
    validateVolumeNameSearchParam: validateVolumeNameSearchParam,
    validateVolumeNetwork: validateVolumeNetwork,
    validateVolumeNetworks: validateVolumeNetworks,
    validateVolumeSize: validateVolumeSize,
    validateVolumeSizeSearchParam: validateVolumeSizeSearchParam,
    validateVolumeState: validateVolumeState,
    validateVolumeType: validateVolumeType
};
