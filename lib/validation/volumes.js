/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var restify = require('restify');


var VALID_VOLUME_NAME_CHARS_REGEXP = /^[a-zA-Z0-9_\.\-]+$/;
var VALID_VOLUME_NAME_REGEXP = /^[a-zA-Z0-9][a-zA-Z0-9_\.\-]+$/;
var VALID_VOLUME_SIZE_REGEXP = /^[1-9][0-9]*$/;
var VALID_VOLUME_TYPES = ['tritonnfs'];
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function validateVolumeId(volumeId) {
    var err;
    var validVolumeId = typeof (volumeId) === 'string' &&
        UUID_RE.test(volumeId);

    if (!validVolumeId) {
        err = new Error('Invalid volume ID: ' + volumeId + '. Volume ' +
            'ID should match ' + UUID_RE);
    }

    return err;
}

function validateVolumeName(volumeName, opts) {
    var err;
    var validVolumeName;

    // Some actions allow non-existent names (empty or undefined), if
    // opts.allowEmpty is truthy, we'll accept a missing name or empty string
    // as valid.
    if (opts && opts.allowEmpty && ((volumeName === undefined) ||
        (typeof (volumeName) === 'string' && volumeName === ''))) {
        validVolumeName = true;
    } else {
        validVolumeName = typeof (volumeName) === 'string' &&
            volumeName !== '' &&
            VALID_VOLUME_NAME_REGEXP.test(volumeName);
    }

    if (!validVolumeName) {
        err = new Error('Invalid volume name: ' + volumeName + '. Volume ' +
            'name should match ' + VALID_VOLUME_NAME_REGEXP);
    }

    return err;
}

// NOTE: This duplicates code from sdc-volapi's lib/validation/volumes.js and
//       should probably eventually be put in a library shared between the two.
function validateVolumeNameSearchParam(name) {
    var coreName;
    var err;
    var nameBegin;
    var nameLen;

    if (typeof (name) !== 'string') {
        err = new Error('name search parameter must be a string');
        return err;
    }

    // 'name' is special because we allow '*' as a prefix or suffix for
    // wildcard searching. As such, we need to validate that the name is
    // valid whether or not it is surrounded by '*'s.
    nameBegin = 0;
    nameLen = name.length;

    if (nameLen > 1 && name[0] === '*') {
        nameBegin++;
        nameLen--;
    }

    if (nameLen > 1 && name[nameBegin + nameLen - 1] === '*') {
        nameLen--;
    }

    // coreName is the name w/o the (optional) '*' prefix or suffix
    coreName = name.substr(nameBegin, nameLen);

    if (!VALID_VOLUME_NAME_CHARS_REGEXP.test(coreName)) {
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

    if (typeof (size) !== 'string') {
        err = new Error('size search parameter must be a string');
        return err;
    }

    if (!VALID_VOLUME_SIZE_REGEXP.test(size)) {
        err = new Error('invalid value for size search parameter, must match '
            + VALID_VOLUME_SIZE_REGEXP.toString());
    }

    return err;
}

function validateVolumeNetwork(volumeNetwork) {
    var err;

    if (typeof (volumeNetwork) !== 'string' || !UUID_RE.test(volumeNetwork)) {
        err = new Error('Invalid volume network: ' + volumeNetwork);
    }

    return err;
}

function validateVolumeNetworks(volumeNetworks) {
    var err;
    var networkValidationErrors = [];
    var volumeNetworksValid = false;

    if (volumeNetworks === undefined) {
        volumeNetworksValid = true;
    } else {
        if (Array.isArray(volumeNetworks)) {
            volumeNetworks.forEach(function checkNetworkValidity(network) {
                var networkValidationErr = validateVolumeNetwork(network);
                if (networkValidationErr !== undefined) {
                    networkValidationErrors.push(networkValidationErr);
                }
            });

            if (networkValidationErrors.length === 0) {
                volumeNetworksValid = true;
            }
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
