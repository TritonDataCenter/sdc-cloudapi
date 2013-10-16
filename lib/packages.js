// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var semver = require('semver');
var restify = require('restify');



// --- Globals

var ResourceNotFoundError = restify.ResourceNotFoundError;



// --- Helpers


function translate(req, pkg) {
    assert.ok(req);
    assert.ok(pkg);
    var p = {
        name: pkg.name,
        memory: Number(pkg.max_physical_memory),
        disk: Number(pkg.quota),
        swap: Number(pkg.max_swap),
        vcpus: (pkg.vcpus) ? Number(pkg.vcpus) : 0,
        'default': pkg['default'] || false
    };

    if (!/6\.5/.test(req.getVersion())) {
        p.id = pkg.uuid;
        p.version = pkg.version;
        if (pkg.description) {
            p.description = pkg.description;
        }

        if (pkg.group) {
            p.group = pkg.group;
        }
    }

    return p;
}



// --- Functions

function load(req, res, next) {
    if (req.url === '/--ping') {
        return next();
    }
    assert.ok(req.account);
    assert.ok(req.sdc.pkg);

    var log = req.log;

    req.pkg = false;

    // Skip package loading and filtering if we're neither on packages
    // end-points or creating/resizing a machine or for machines list
    if (!/\/packages/.test(req.url) && !(/\/machines/.test(req.url))) {
        return next();
    }

    return req.sdc.pkg.list(function (err, packages) {
        if (err) {
            return next(err);
        }

        req.packages = packages.filter(function (p) {
            return (!p.owner_uuid || p.owner_uuid === req.account.uuid ||
                (Array.isArray(p.owner_uuid) &&
                p.owner_uuid.indexOf(req.account.uuid) !== -1));
        }) || [];
        var pkg;
        var _p = req.params['package'];
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
                if (semver.gte(semver.valid(a.version),
                        semver.valid(b.version))) {
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
    var opts = {};
    // If we have a search filter:
    if (req.params.name) {
        opts.name = req.params.name;
    }

    if (req.params.memory) {
        opts.max_physical_memory = req.params.memory;
    }

    if (req.params.disk) {
        opts.quota = req.params.disk;
    }

    if (req.params.swap) {
        opts.max_swap = req.params.swap;
    }

    if (req.params.version) {
        opts.version = req.params.version;
    }

    if (req.params.vcpus) {
        opts.vcpus = req.params.vcpus;
    }

    if (req.params.group) {
        opts.group = req.params.group;
    }

    if (Object.keys(opts).length !== 0) {
        opts.objectclass = 'sdcpackage';
        var filter = '(&';
        Object.keys(opts).forEach(function (o) {
            filter += '(' + o + '=' + opts[o] + ')';
        });
        filter += ')';
        return req.sdc.pkg.list(filter, function (err, pkgs) {
                if (err) {
                    return next(err);
                }

                req.packages = pkgs || [];
                req.packages.forEach(function (p) {
                    if (p.active !== 'false') {
                        return packages.push(translate(req, p));
                    } else {
                        return false;
                    }
                });

                log.debug('GET %s => %j', req.path(), packages);
                res.send(packages);
                return next();
        });
    } else {
        req.packages.forEach(function (p) {
            if (p.active !== 'false') {
                return packages.push(translate(req, p));
            } else {
                return false;
            }
        });

        log.debug('GET %s => %j', req.path(), packages);
        res.send(packages);
        return next();
    }
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
