/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var verror = require('verror');

function waitForTransitionToState(cloudapiClient, volumeUuid, expectedState,
    callback) {
    assert.object(cloudapiClient, 'cloudapiClient');
    assert.uuid(volumeUuid, 'volumeUuid');
    assert.string(expectedState, 'expectedState');
    assert.func(callback, 'callback');

    var MAX_NB_RETRIES = 120;
    var nbRetriesSoFar = 0;
    var RETRY_DELAY_IN_MS = 1000;

    function pollVolumeState() {
        if (nbRetriesSoFar > MAX_NB_RETRIES) {
            callback();
            return;
        }

        ++nbRetriesSoFar;

        cloudapiClient.get('/my/volumes/' + volumeUuid,
            function onGetVolume(getVolumeErr, req, res, volume) {
                if (!getVolumeErr && volume !== undefined &&
                    volume.state === expectedState) {
                    callback();
                } else {
                    setTimeout(pollVolumeState, RETRY_DELAY_IN_MS);
                }
            });
    }

    pollVolumeState();
}

function waitForDeletion(cloudapiClient, volumeUuid, callback) {
    assert.object(cloudapiClient, 'cloudapiClient');
    assert.uuid(volumeUuid, 'volumeUuid');
    assert.func(callback, 'callback');

    var MAX_NB_RETRIES = 120;
    var nbRetriesSoFar = 0;
    var RETRY_DELAY_IN_MS = 1000;

    function pollVolumeState() {
        if (nbRetriesSoFar > MAX_NB_RETRIES) {
            callback();
        } else {
            ++nbRetriesSoFar;

            cloudapiClient.get('/my/volumes/' + volumeUuid,
                function onGetVolume(getVolumeErr, req, res, volume) {
                    if (getVolumeErr) {
                        if (verror.hasCauseWithName(getVolumeErr,
                            'VolumeNotFoundError')) {

                            callback();
                            return;
                        }
                        callback(getVolumeErr);
                    } else {
                        setTimeout(pollVolumeState, RETRY_DELAY_IN_MS);
                    }
                });
        }
    }

    pollVolumeState();
}

module.exports = {
    waitForTransitionToState: waitForTransitionToState,
    waitForDeletion: waitForDeletion
};
