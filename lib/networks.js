// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var restify = require('restify');


// --- Functions
function load(req, res, next) {
    assert.ok(req.account);
    assert.ok(req.sdc.napi);

    var log = req.log;

    req.nets = [];

    // Skip network loading and filtering if we're neither on networks
    // end-points or creating a machine
    if (!/\/networks/.test(req.url) &&
        !(/\/machines$/.test(req.url) && req.method.toUpperCase() === 'POST')) {
        return next();
    }

    return req.sdc.napi.listNetworks({
        provisionable_by: req.account.uuid
    }, function (err, networks) {
        if (err) {
            return next(err);
        }
        req.networks = networks || [];
        var admin, external;

        admin = networks.filter(function (net) {
            return (net.name === 'admin');
        });

        external = networks.filter(function (net) {
            return (net.name === 'external');
        });

        if (admin.length) {
            req.nets.push(admin.pop().uuid);
        }

        if (external.length) {
            req.nets.push(external.pop().uuid);
        }

        log.debug('load selected networks %j', req.nets);

        return next();

    });
}


// --- API

module.exports = {
    load: load
};
