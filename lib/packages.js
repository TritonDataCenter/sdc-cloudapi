// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var restify = require('restify');



// --- Globals

var ResourceNotFoundError = restify.ResourceNotFoundError;



// --- Helpers

function translate(pkg) {
    assert.ok(pkg);

    return {
        urn: pkg.urn,
        name: pkg.name,
        memory: pkg.max_physical_memory,
        disk: pkg.quota,
        vcpus: pkg.vcpus,
        swap: pkg.max_swap,
        'default': pkg['default'] || false
    };
}



// --- Functions

function load(req, res, next) {
    assert.ok(req.account);
    assert.ok(req.sdc.ufds);
    // assert.ok(req.sdc.mapi);

    var customer = req.account.uuid,
        log = req.log;

    req.pkg = false;

    return req.sdc.ufds.listPackages(function (err, packages) {
        if (err) {
            return next(err);
        }

        req.packages = packages || [];

        var pkg,
           _p = req.params['package'];

        if (_p) {
            pkg = req.packages.filter(function (p) {
                if (_p === p.urn || _p === p.name) {
                    return p;
                }

                return undefined;
            });
        } else {
            pkg = req.packages.filter(function (p) {
                if (p['default'] === true) {
                    return p;
                }

                return undefined;
            });
        }

        if (pkg.length) {
            log.debug('load selected package %j', req.pkg);
            req.pkg = pkg.pop();
        }

        return next();
    });
}


function list(req, res, next) {
    var log = req.log,
        packages = req.packages.map(translate);

    log.debug('GET %s => %j', req.path, packages);
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

    pkg = translate(req.pkg);

    log.debug('GET %s => %j', req.path, pkg);
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
