/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var restify = require('restify');

var VALID_VOLUME_NAME_REGEXP = /^[a-zA-Z0-9][a-zA-Z0-9_\.\-]+$/;
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

function validateVolumeName(volumeName) {
    var err;
    var validVolumeName = typeof (volumeName) === 'string' &&
        VALID_VOLUME_NAME_REGEXP.test(volumeName);

    if (!validVolumeName) {
        err = new Error('Invalid volume name: ' + volumeName + '. Volume ' +
            'name should match ' + VALID_VOLUME_NAME_REGEXP);
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

function validateVolumeNetworks(volumeNetworks) {
    var err;
    var invalidNetworks;
    var volumeNetworksValid = false;

    if (volumeNetworks === undefined) {
        volumeNetworksValid = true;
    } else {
        if (Array.isArray(volumeNetworks)) {
            invalidNetworks =
                volumeNetworks.filter(function filterValidNetwork(network) {
                    if (typeof (network) === 'string' &&
                        UUID_RE.test(network)) {
                        return false;
                    }

                    return true;
                });

            if (!invalidNetworks || invalidNetworks.length === 0) {
                volumeNetworksValid = true;
            }
        }
    }

    if (!volumeNetworksValid) {
        err = new Error('Invalid networks: ' + volumeNetworks);
    }

    return err;
}

module.exports = {
    validateVolumeName: validateVolumeName,
    validateVolumeNetworks: validateVolumeNetworks,
    validateVolumeSize: validateVolumeSize,
    validateVolumeType: validateVolumeType,
    validateVolumeId: validateVolumeId
};