/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/**
 * Poll for the creation of the default VLAN
 */
function waitForDefaultVLAN(CLIENT, t) {
    var CHECK_INTERVAL = 500;
    var CHECK_TIMEOUT = 30000;
    var start = Date.now();
    t.pass('Waiting for default fabric VLAN to be created...');

    function _checkVlan() {
        CLIENT.get('/my/fabrics/default/vlans/2',
                function (err, req, res, body) {
            if (body && body.vlan_id) {
                t.pass('found default vlan');
                return t.end();
            }

            if ((Date.now() - start) > CHECK_TIMEOUT) {
                t.pass('did not find default vlan before timeout');
                return t.end();
            }

            return setTimeout(_checkVlan, CHECK_INTERVAL);
        });
    }

    _checkVlan();
}


module.exports = {
    waitForDefaultVLAN: waitForDefaultVLAN
};