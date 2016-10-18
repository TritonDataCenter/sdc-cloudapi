/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert-plus');
var restify = require('restify');



///--- Functions

function emptyThrottle(req, res, next) {
    return next();
}


function getThrottle(type, config, name) {
    var t = config[type];

    // no throttles for IP or user even exist
    if (!t) {
        return emptyThrottle;
    }

    // No-op - specifying a 'false' key disables throttling altogether
    if (t[name] === false) {
        return emptyThrottle;
    }

    // If it's not there, try to fallback to the global one
    if (!t[name]) {
        name = 'all';
    }

    // Try to return the global throttle, or just fail it out
    return t[name] ? restify.throttle(t[name]) : emptyThrottle;
}



///--- Exports

module.exports = {

    getIpThrottle: function getIpThrottle(config, name) {
        assert.object(config);
        assert.string(name);

        return getThrottle('ipThrottles', config, name);
    },

    getUserThrottle: function getUserThrottle(config, name) {
        assert.object(config);
        assert.string(name);

        return getThrottle('userThrottles', config, name);
    },

    getEmptyThrottle: function () {
        return emptyThrottle;
    }
};
