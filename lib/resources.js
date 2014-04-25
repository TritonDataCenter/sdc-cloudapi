/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * This file includes the required functions to deal role-tagging of CloudAPI
 * resources, mainly focused into "virtual" resources w/o a real entity to
 * attach the role tags to, like "a list of users" or "the ability to create
 * machines".
 *
 * A "role-tag" is merely the UUID of a sdcAccountRole being assigned to any
 * of the resources managed by CloudAPI.
 *
 * These "virtual resources" are saved into UFDS using sdcAccountResource
 * objectclass. The main difference between sdcAccountResource and how CloudAPI
 * handles role-tags over a given resource is that CloudAPI takes role names
 * and add those as UUIDs into sdcAccountResource, or into any of the entities
 * where it can set the role-tag value w/o having to rely into
 * sdcAccountResource, like individual machines.
 *
 * Role tags added to CloudAPI resources (virtual or real), together with the
 * active roles assigned to sdcAccountUsers, will rule the access to these
 * resources by evaluation of the sdcAccountPolicy rules defined for the
 * sdcAccountRoles involved.
 */
var util = require('util');

var assert = require('assert');
var restify = require('restify');
var vasync = require('vasync');
var libuuid = require('libuuid');
var clone = require('clone');

var membership = require('./membership'),
    preloadGroups = membership.preloadGroups;

function resourceName(req, res, next) {
    assert.ok(req.params.account);

    var p = req.path().split('/');
    p.shift();

    if (p[0] !== req.params.account) {
        p[0] = req.params.account;
    }

    // For now let's keep this restricted to top-level URIs like
    // "/:account/machines" or "/:account/users", and "ignore" individual
    // resources (user top level resource roles)
    if (p.length === 1) {
        req.resourcename = util.format('/%s', p[0]);
    } else {
        req.resourcename = util.format('/%s/%s', p[0], p[1]);
    }
    return next();
}

// TODO: For now we are handling only list/create resource URIs.
function loadResource(req, res, next) {
    assert.ok(req.resourcename);
    assert.ok(req.account);
    assert.ok(req.sdc);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;
    req.resource = {
        name: req.resourcename,
        account: id,
        roles: []
    };

    // At first, let's load only "list" resources and test it.
    // We need to make a decission on which resources we want to be
    // tagged with role-tags, other than machines. Most likely we may
    // want just to tag machines and make everything depend on parent
    // resource.
    ufds.getResource(id, req.resourcename, function (err, resource) {
        if (err) {
            if (err.statusCode === 404) {
                console.log('Resource %s not found', req.resourcename);
                return next();
            } else {
                return next(err);
            }
        } else {
            req.resource.uuid = resource.uuid;
            // If we have a resource from UFDS, we need to do the memberrole.DN
            // to role name translation.
            if (resource.memberrole) {
                if (!Array.isArray(resource.memberrole)) {
                    resource.memberrole = [resource.memberrole];
                }
                
                return membership.preloadGroups(req, resource.memberrole, {
                    searchby: 'dn'
                }, function (err, roles) {
                    if (err) {
                        return next(err);
                    }
                    req.resource.roles = roles;
                    return next();
                });
            } else {
                return next();
            }
        }
    });
}

// TODO: For now we are handling only list/create resource URIs.
function saveResource(req, res, next) {
    assert.ok(req.resourcename);
    assert.ok(req.account);
    assert.ok(req.sdc);
    assert.ok(req.resource);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    var validResources = [
        'machines', 'users', 'roles', 'packages',
        'images', 'policies', 'keys',
        'analytics', 'fwrules', 'networks'
    ];

    if (validResources.indexOf(req.params.resource_name) === -1) {
        return next(new restify.ResourceNotFoundError(
                    req.params.resource_name + ' is not a valid resource'));
    }

    var entry = {
        name: util.format('/%s/%s', req.account.login, req.params.resource_name),
        account: id
    };

    if (!req.resource) {
        req.resource = entry;
    }

    var pipelineFuncs = [];

    // We do have a list of role names that we need to translate into role DNs
    // before we save them as memberrole into sdcAccountResource:
    if (req.params['role-tag']) {
        if (!Array.isArray(req.params['role-tag'])) {
            req.params['role-tag'] = [req.params['role-tag']];
        }

        pipelineFuncs.push(function _loadRoles(_, _cb) {
            membership.preloadGroups(req, req.params['role-tag'],
                function (err, roles) {
                if (err) {
                    _cb(err);
                } else {
                    req.resource.roles = roles;
                    entry.roles = clone(roles);
                    _cb(null);
                }
            });
        });
    } else if (req.resource.roles) {
        entry.roles = clone(req.resource.roles);
    }

    entry.uuid = req.resource.uuid ? req.resource.uuid :
        libuuid.create();

    pipelineFuncs.push(function _translateEntryRoles(_, _cb) {
        entry.memberrole = entry.roles.map(function (r) {
            return ((r.dn) ? r.dn : null);
        }).filter(function (x) {
            return (x !== null);
        });

        delete entry.roles;
        _cb(null);
    });

    vasync.pipeline({funcs: pipelineFuncs}, function (err, results) {
        if (err) {
            return next(err);
        }

        return ufds.modifyResource(id, entry.uuid, entry,
            function (er, resource) {
            if (er) {
                return next(er);
            }
            if (resource.memberrole) {
                if (!Array.isArray(resource.memberrole)) {
                    resource.memberrole = [resource.memberrole];
                }
                resource.memberrole = resource.memberrole.map(function (mr) {
                    var name;
                    req.resource.roles.forEach(function (r) {
                        if (r.dn === mr) {
                            name = r.name;
                        }
                    });
                    return name;
                });
            }
            var r = {
                name: resource.name,
                'role-tag': resource.memberrole || []
            };
            log.debug('PUT %s -> %j', req.path(), r);
            res.send(r);
            return next();
        });
    });
}

// TODO: For now we are handling only list/create resource URIs.
function getResource(req, res, next) {
    assert.ok(req.resourcename);
    assert.ok(req.account);
    assert.ok(req.sdc);

    var r = {
        name: req.resource.name || util.format('/%s/%s', req.account.login, req.resourcename),
        'role-tag': []
    };

    if (req.resource.roles) {
        req.resource.roles.forEach(function (mr) {
            r['role-tag'].push(mr.name);
        });
    }

    res.send(r);
    req.log.debug('GET %s?role-tag=true %j', req.path(), r);
    return next();
}


function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    // So far, this would be fine for any top level list/create resource route:
    server.put({
        path: '/:account/:resource_name',
        name: 'ReplaceResourceRoleTags'
    }, before, saveResource);
}

module.exports = {
    loadResource: loadResource,
    resourceName: resourceName,
    getResource: getResource,
    mount: mount
};
