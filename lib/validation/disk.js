/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2024 MNX Cloud, Inc.
 * Copyright 2026 Edgecast Cloud LLC.
 */


/*
 * This mirrors vmadm, which validates disks.*.block_size as an integer (a
 * string that parses cleanly as one is accepted too) before applying the range
 * and power-of-2 checks below. Without the type check those comparisons coerce
 * non-numbers to NaN, which is false against every bound, so "garbage", {} and
 * 4096.5 would all be reported as valid.
 */
function validRecordSize(candidate) {
    var size;

    if (typeof (candidate) !== 'number' && typeof (candidate) !== 'string') {
        return (false);
    }

    size = Number(candidate);

    if (!Number.isInteger(size)) {
        return (false);
    }

    if (size < 512) {
        // too low
        return (false);
    } else if (size > 131072) {
        // too high
        return (false);
    } else if ((size & (size - 1)) !== 0) {
        // not a power of 2
        return (false);
    }

    return (true);
}

module.exports = {
    validRecordSize: validRecordSize
};
