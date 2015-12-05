/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015 Joyent, Inc.
 */

var assert = require('assert-plus');


// ---- support stuff

var UUID_RE = /^([a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}?)$/i;
function isUuid(s) {
    assert.string(s, 's');
    return UUID_RE.test(s);
}


//---- exports

module.exports = {
    isUuid: isUuid
};

// vim: set softtabstop=4 shiftwidth=4:
