// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var s = require('semver');
var restify = require('restify');



// --- Globals

var ResourceNotFoundError = restify.ResourceNotFoundError;



// --- Helpers


function translate(req, pkg) {
    assert.ok(req);
    assert.ok(pkg);
    var p = {
        name: pkg.name,
        memory: pkg.max_physical_memory,
        disk: pkg.quota,
        swap: pkg.max_swap,
        'default': pkg['default'] || false
    };

    if (!/6\.5/.test(req.getVersion())) {
        p.id = pkg.uuid;
        p.vcpus = pkg.vcpus;
        p.version = pkg.version;
    }

    return p;
}



// --- Functions

function load(req, res, next) {
    assert.ok(req.account);
    assert.ok(req.sdc.pkg);

    var log = req.log;

    req.pkg = false;

    // Skip package loading and filtering if we're neither on packages
    // end-points or creating/resizing a machine
    if (!/\/packages/.test(req.url) &&
        !(/\/machines/.test(req.url) && req.method.toUpperCase() === 'POST')) {
        return next();
    }

    return req.sdc.pkg.list(function (err, packages) {
        if (err) {
            return next(err);
        }

        req.packages = packages || [];
        var pkg,
           _p = req.params['package'];
        if (_p) {
            pkg = req.packages.filter(function (p) {
                if (_p === p.name || _p === p.uuid) {
                    return p;
                }

                return undefined;
            });
        } else {
            pkg = req.packages.filter(function (p) {
                if (p['default'].toString() === 'true') {
                    return p;
                }

                return undefined;
            });
        }

        if (pkg.length) {
            req.pkg = pkg.reduce(function (a, b) {
                if (s.gte(s.valid(a.version), s.valid(b.version))) {
                    return a;
                } else {
                    return b;
                }
            });
            log.debug('load selected package %j', req.pkg);
        }

        return next();
    });
}


function list(req, res, next) {
    var log = req.log;
    var packages = [];
    req.packages.forEach(function (p) {
        return packages.push(translate(req, p));
    });

    log.debug('GET %s => %j', req.path(), packages);
    res.send(packages);
    return next();
}


function get(req, res, next) {
    var log = req.log,
        _p = req.params['package'],
        pkg;

    if (!req.pkg) {
        return next(new ResourceNotFoundError('%s not found', _p));
    }

    pkg = translate(req, req.pkg);

    log.debug('GET %s => %j', req.path(), pkg);
    res.send(pkg);
    return next();
}



function mount(server, before) {
    assert.argument(server, 'object', server);

    server.get({
        path: '/:account/packages',
        name: 'ListPackages'
    }, before || list, before ? list : undefined);

    server.head({
        path: '/:account/packages',
        name: 'HeadPackages'
    }, before || list, before ? list : undefined);

    server.get({
        path: '/:account/packages/:package',
        name: 'GetPackage'
    }, before || get, before ? get : undefined);

    server.head({
        path: '/:account/packages/:package',
        name: 'HeadPackage'
    }, before || get, before ? get : undefined);

    return server;
}



// --- API

module.exports = {
    load: load,
    mount: mount
};
