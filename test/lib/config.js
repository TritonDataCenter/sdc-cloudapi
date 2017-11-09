/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');

function waitForAccountConfigReady(client, callback) {
    assert.object(client, 'client');
    assert.func(callback, 'callback');

    var nbTries = 0;
    var MAX_NUM_TRIES = 20;
    var TRY_DELAY_IN_MS = 1000;

    function getConfig() {
        client.get('/my/config',
            function onGetConfig(getConfigErr, req, res, ufdsConfig) {
                ++nbTries;

                if (getConfigErr ||
                    (ufdsConfig && ufdsConfig.default_network === undefined)) {
                    if (nbTries >= MAX_NUM_TRIES) {
                        callback(new Error('max number of tries reached'));
                        return;
                    } else {
                        setTimeout(getConfig, TRY_DELAY_IN_MS);
                        return;
                    }
                } else {
                    callback(null, ufdsConfig);
                    return;
                }
            });
    }

    getConfig();
}

module.exports = {
    waitForAccountConfigReady: waitForAccountConfigReady
};