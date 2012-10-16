// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var s = require('semver');
var restify = require('restify');



// --- Globals

var ResourceNotFoundError = restify.ResourceNotFoundError;



// --- Helpers


function translate_6_5(pkg) {
    assert.ok(pkg);

    return {
        name: pkg.name,
        memory: pkg.max_physical_memory,
        disk: pkg.quota,
        swap: pkg.max_swap,
        'default': pkg['default'] || false
    };
}


function translate(pkg) {
    assert.ok(pkg);

    return {
        name: pkg.name,
        memory: pkg.max_physical_memory,
        disk: pkg.quota,
        swap: pkg.max_swap,
        'default': pkg['default'] || false,
        urn: pkg.urn,
        uuid: pkg.uuid,
        vcpus: pkg.vcpus,
        version: pkg.version
    };
}



// --- Functions

function load(req, res, next) {
    assert.ok(req.account);
    assert.ok(req.sdc.pkg);

    var log = req.log;

    req.pkg = false;

    return req.sdc.pkg.list(function (err, packages) {
        if (err) {
            return next(err);
        }

        req.packages = packages || [];
        var pkg,
           _p = req.params['package'];
        if (_p) {
            pkg = req.packages.filter(function (p) {
                if (_p === p.urn || _p === p.name || _p === p.uuid) {
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


function list_6_5(req, res, next) {
    var log = req.log,
        packages = req.packages.map(translate_6_5);

    log.debug('GET %s => %j', req.path, packages);
    res.send(packages);
    return next();
}


function get_6_5(req, res, next) {
    var log = req.log,
        _p = req.params['package'],
        pkg;

    if (!req.pkg) {
        return next(new ResourceNotFoundError('%s not found', _p));
    }

    pkg = translate_6_5(req.pkg);

    log.debug('GET %s => %j', req.path, pkg);
    res.send(pkg);
    return next();
}



function mount(server, before) {
    assert.argument(server, 'object', server);

    server.get({
        path: '/:account/packages',
        name: 'ListPackages',
        version: '7.0.0'
    }, before || list, before ? list : undefined);

    server.head({
        path: '/:account/packages',
        name: 'HeadPackages',
        version: '7.0.0'
    }, before || list, before ? list : undefined);

    server.get({
        path: '/:account/packages/:package',
        name: 'GetPackage',
        version: '7.0.0'
    }, before || get, before ? get : undefined);

    server.head({
        path: '/:account/packages/:package',
        name: 'HeadPackage',
        version: '7.0.0'
    }, before || get, before ? get : undefined);

    // Backward compatibility 6.5 API
    server.get({
        path: '/:account/packages',
        name: 'ListPackages',
        version: '6.5.0'
    }, before || list_6_5, before ? list_6_5 : undefined);

    server.head({
        path: '/:account/packages',
        name: 'HeadPackages',
        version: '6.5.0'
    }, before || list_6_5, before ? list_6_5 : undefined);

    server.get({
        path: '/:account/packages/:package',
        name: 'GetPackage',
        version: '6.5.0'
    }, before || get_6_5, before ? get_6_5 : undefined);

    server.head({
        path: '/:account/packages/:package',
        name: 'HeadPackage',
        version: '6.5.0'
    }, before || get_6_5, before ? get_6_5 : undefined);

    return server;
}



// --- API

module.exports = {
    load: load,
    mount: mount
};
