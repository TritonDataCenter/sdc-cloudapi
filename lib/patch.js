// Copyright 2012 Joyent, Inc.  All rights reserved.

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
    if (typeof (arg) !== type)
        throw new TypeError(name + ' (' + type.capitalize() + ') required');
};
