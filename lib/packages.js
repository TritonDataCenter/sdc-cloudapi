// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var semver = require('semver');
var restify = require('restify');



// --- Globals

var ResourceNotFoundError = restify.ResourceNotFoundError;
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;


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

// opts - k/v pairs intended to build a search filter. Note that
// objectclass=sdcpackage will be always added:
function searchPackages(opts, req, cb) {
    assert.ok(opts);
    assert.ok(req);
    opts.objectclass = 'sdcpackage';

    var filter = '(&';
    Object.keys(opts).forEach(function (o) {
        filter += '(' + o + '=' + opts[o] + ')';
    });
    filter += ')';

    req.sdc.pkg.list(filter, function (err, pkgs) {
        if (err) {
            return cb(err);
        }

        return cb(null, pkgs);
    });
}


function loadPackages(req, res, next) {
    if (req.url === '/--ping') {
        return next();
    }
    assert.ok(req.account);
    assert.ok(req.sdc.pkg);

    var log = req.log;
    var url = req.getUrl();

    req.pkg = false;


    // Skip package loading and filtering if we're neither on
    // GET /packages[/:uuid|:name] end-points or machine(s) related
    // (we can skip packages listing into every "single machine" action
    // but resize)
    if (!/\/packages/.test(req.url) && (!/\/machines$/.test(url.pathname) &&
            (req.method.toLowerCase() !== 'post' ||
            req.params.action !== 'resize'))) {
        return next();
    }

    // Given packages list applies its own filters, we'd rather skip it here:
    if (/\/packages$/.test(url.pathname)) {
        return next();
    }
    var packageUUID = req.params['package'];
    // If this is an package request by UUID, there's no need to
    // preload anything else. (It is lame, though, that we need to support
    // retrieving a package by name w/o the index on ufds.name yet).
    if (packageUUID && UUID_RE.test(packageUUID)) {
        return req.sdc.pkg.get(req.params['package'], function (err, pkg) {
            if (err) {
                return next(err);
            }
            req.pkg = pkg;
            req.log.debug('load selected package %j', req.pkg);
            return next();
        });
    }

    // Also, if we're trying to retrieve a package by name, we can just search
    // by name into "available" packages:
    if (/\/packages\/.+/.test(url.pathname)) {
        return searchPackages({
            name: req.params['package'],
            active: true
        }, req, function (err, pkgs) {
            if (err) {
                return next(err);
            }

            pkgs = pkgs.filter(function (p) {
                return (!p.owner_uuid || p.owner_uuid === req.account.uuid ||
                    (Array.isArray(p.owner_uuid) &&
                    p.owner_uuid.indexOf(req.account.uuid) !== -1));
            }) || [];

            if (pkgs.length) {
                req.pkg = pkgs.reduce(function (a, b) {
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
    // Machines listing:
    // No restrictions at all, given we don't know those when each machine
    // was created.
    if (/\/machines$/.test(url.pathname) &&
            req.method.toLowerCase() !== 'post') {
        return searchPackages({}, req, function (err, pkgs) {
            if (err) {
                return next(err);
            }
            req.packages = pkgs;
            return next();
        });
    }

    // At this point, we're either a create/resize machine. Ownership and
    // active packages restrictions applied. Also, we need to provide a
    // "default" package for 6.5 provisioning:
    return searchPackages({
        active: true
    }, req, function (err, pkgs) {
        if (err) {
            return next(err);
        }

        req.packages = pkgs.filter(function (p) {
            return (!p.owner_uuid || p.owner_uuid === req.account.uuid ||
                (Array.isArray(p.owner_uuid) &&
                p.owner_uuid.indexOf(req.account.uuid) !== -1));
        }) || [];

        var pkg;
        var _p = req.params['package'];
        if (_p) {
            pkg = req.packages.filter(function (p) {
                return (_p === p.name || _p === p.uuid);
            });
        } else {
            pkg = req.packages.filter(function (p) {
                return (p['default'].toString() === 'true');
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
            log.info('load selected package %j', req.pkg);
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

    opts.active = 'true';

    return searchPackages(opts, req, function (err, pkgs) {
        if (err) {
            return next(err);
        }

        packages = pkgs.filter(function (p) {
            return (!p.owner_uuid || p.owner_uuid === req.account.uuid ||
                (Array.isArray(p.owner_uuid) &&
                p.owner_uuid.indexOf(req.account.uuid) !== -1));
        }) || [];

        packages = pkgs.map(function (p) {
            return translate(req, p);
        });

        log.debug('GET %s => %j', req.path(), packages);
        res.send(packages);
        return next();
    });
}


function get(req, res, next) {
    var log = req.log,
        _p = req.params['package'];

    if (!req.pkg) {
        return next(new ResourceNotFoundError('%s not found', _p));
    }

    var pkg = translate(req, req.pkg);
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
    loadPackages: loadPackages,
    mount: mount
};
