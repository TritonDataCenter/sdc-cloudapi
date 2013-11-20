// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var restify = require('restify');



///--- Functions

function emptyThrottle(req, res, next) {
    return next();
}


function getThrottle(type, config, name) {
    var t = config[type];

    // no throttles for IP or user even exist
    if (!t)
        return emptyThrottle;

    // No-op - specifying a 'false' key disables throttling altogether
    if (t[name] === false)
        return emptyThrottle;

    // If it's not there, try to fallback to the global one
    if (!t[name])
        name = 'all';

    // Try to return the global throttle, or just fail it out
    return t[name] ? restify.throttle(t[name]) : emptyThrottle;
}



///--- Exports

module.exports = {

    getIpThrottle: function getIpThrottle(config, name) {
        assert.argument('config', 'object', config);
        assert.argument('name', 'string', name);

        return getThrottle('ipThrottles', config, name);
    },

    getUserThrottle: function getUserThrottle(config, name) {
        assert.argument('config', 'object', config);
        assert.argument('name', 'string', name);

        return getThrottle('userThrottles', config, name);
    }
};
