/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Note retrieving packages using name instead of uuid
 * is deprecated since 7.2.0. (PENDING!):
 *
 * if (semver.satisfies('7.2.0', v) || semver.ltr('7.2.0', v)) {
 * }
 */

var assert = require('assert-plus');
var util = require('util');
var semver = require('semver');
var restify = require('restify');

var resources = require('./resources');

// --- Globals

var ResourceNotFoundError = restify.ResourceNotFoundError;
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;


// --- Helpers


function translate(req, pkg) {
    assert.ok(req);
    assert.ok(pkg);

    var p = {
        name:   pkg.name,
        memory: pkg.max_physical_memory,
        disk:   pkg.quota,
        swap:   pkg.max_swap,
        vcpus:  pkg.vcpus || 0,
        lwps:   pkg.max_lwps,
        'default': pkg['default'] || false
    };

    p.id = pkg.uuid;
    p.version = pkg.version;

    if (pkg.description) {
        p.description = pkg.description;
    }

    if (pkg.group) {
        p.group = pkg.group;
    }

    return p;
}



// --- Functions
// TODO: this mother needs a refactor

function loadPackages(req, res, next) {
    var pathname = req.getUrl().pathname;

    if (pathname === '/--ping') {
        return next();
    }

    assert.ok(req.account);
    assert.ok(req.sdc.papi);

    var log = req.log;

    req.pkg = false;

    // Given packages list applies its own filters, we'd rather skip it here:
    if (/\/packages$/.test(pathname)) {
        return next();
    }

    var ownerUuid = req.account.uuid;
    var pkgName = req.params['package'];

    // If this is a package request by UUID, there's no need to preload anything
    // else.
    if (pkgName) {
        if (UUID_RE.test(pkgName)) {
            return req.sdc.papi.get(pkgName, { owner_uuids: ownerUuid},
                                    function (err, pkg) {
                if (err) {
                    return next(err);
                }

                req.pkg = pkg;
                req.log.debug('load selected package %j', req.pkg);

                return next();
            });

        // If we're trying to retrieve a package by name, we can just search
        // by name in "available" packages:
        } else {
            return req.sdc.papi.list({
                name: pkgName,
                owner_uuids: ownerUuid,
                active: true
            }, {}, function (err, pkgs) {
                if (err) {
                    return next(err);
                }

                if (!pkgs.length) {
                    return next();
                }

                var valid = semver.valid;
                req.pkg = pkgs.reduce(function (a, b) {
                    if (semver.gte(valid(a.version), valid(b.version))) {
                        return a;
                    } else {
                        return b;
                    }
                });

                log.debug('load selected package %j', req.pkg);
                return next();
            });
        }
    }

    // Machines listing:
    // No restrictions at all, given we don't know those when each machine
    // was created.
    if (/\/machines$/.test(pathname) &&
        req.method.toLowerCase() !== 'post') {

        return req.sdc.papi.list({}, {}, function (err, pkgs) {
            if (err) {
                return next(err);
            }

            req.packages = pkgs;
            return next();
        });
    }

    // Update (trent, Sep 2015). AFAICT, the next comment block is wrong:
    // Only ResizeMachine gets through. And *then* machines.js#resize has
    // a comment to disallow the default package, but AFAICT *uses* it.
    // Caveat usor. This whole 'loadPackages' design needs a wash.

    if (req.method.toLowerCase() !== 'post' ||
            req.params.action !== 'resize') {
        return next();
    }

    // At this point, we're either a create/resize machine. Ownership and
    // active packages restrictions applied. Also, we need to provide a
    // "default" package for 6.5 provisioning (deprecated, but not yet removed):
    return req.sdc.papi.list({
        owner_uuids: ownerUuid,
        active: true
    }, {}, function (err, pkgs) {
        if (err) {
            return next(err);
        }

        req.packages = pkgs;

        var pkg = pkgs.filter(function (p) {
            return p.default === true;
        });

        if (pkg.length) {
            var valid = semver.valid;

            req.pkg = pkg.reduce(function (a, b) {
                if (semver.gte(valid(a.version), valid(b.version))) {
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
    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }
    var params = req.params;
    var opts = {};

    if (params.name) {
        opts.name = params.name;
    }

    if (req.params.memory) {
        opts.max_physical_memory = params.memory;
    }

    if (req.params.disk) {
        opts.quota = params.disk;
    }

    if (req.params.swap) {
        opts.max_swap = params.swap;
    }

    if (req.params.lwps) {
        opts.max_lwps = params.lwps;
    }

    if (req.params.version) {
        opts.version = params.version;
    }

    if (req.params.vcpus) {
        opts.vcpus = params.vcpus;
    }

    if (req.params.group) {
        opts.group = params.group;
    }

    opts.active = true;
    opts.owner_uuids = req.account.uuid;

    return req.sdc.papi.list(opts, { escape: false }, function (err, pkgs) {
        if (err) {
            return next(err);
        }

        pkgs = pkgs.map(function (p) {
            return translate(req, p);
        });

        req.log.debug('GET %s => %j', req.path(), pkgs);

        res.send(pkgs);
        return next();
    });
}


function get(req, res, next) {
    var log = req.log,
        _p = req.params['package'];

    if (!req.pkg) {
        return next(new ResourceNotFoundError('%s not found', _p));
    }

    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }

    var pkg = translate(req, req.pkg);
    log.debug('GET %s => %j', req.path(), pkg);
    res.send(pkg);
    return next();
}



function mount(server, before) {
    assert.object(server);

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
