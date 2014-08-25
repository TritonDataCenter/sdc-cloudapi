/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert');



// Contains patches to prototypes only that aren't egregious

if (!String.prototype.toBoolean) {
    String.prototype.toBoolean = function toBoolean() {
        return (/^true$/i).test(this);
    };
}


if (!String.prototype.capitalize) {
    String.prototype.capitalize = function capitalize() {
        return this.charAt(0).toUpperCase() + this.slice(1);
    };
}

// Patch assert
assert.argument = function assertArgument(name, type, arg) {
    if (typeof (arg) !== type) {
        throw new TypeError(name + ' (' + type.capitalize() + ') required');
    }
};
