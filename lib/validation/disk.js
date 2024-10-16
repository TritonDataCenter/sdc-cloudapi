/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2024 MNX Cloud, Inc.
 */


// This is the same function from vmadm.
function validRecordSize(candidate) {
    if (candidate < 512) {
        // too low
        return (false);
    } else if (candidate > 131072) {
        // too high
        return (false);
    } else if ((candidate & (candidate - 1)) !== 0) {
        // not a power of 2
        return (false);
    }

    return (true);
}

module.exports = {
    validRecordSize: validRecordSize
};
