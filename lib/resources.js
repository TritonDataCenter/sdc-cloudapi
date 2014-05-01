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


// There are several possibilities regarding request path. The most common one
// is '/:account/:resource[/:resource_id|:resource_name]' which includes
// 'users', 'policies', 'keys', 'roles', 'datacenters', 'images', 'packages',
// 'machines', 'analytics' and 'fwrules'.
//
// Then, there are some special cases:
// - Account resource path is just '/:account'.
// - Sub User Keys have a nested path of the form:
//   '/:account/users/:login/keys[/:keyid]'
// - Machines may have nested resources like tags, metadata, ... On this case
//   it doesn't really matter b/c the role-tag can be added only at machine
//   level and it'll be inherited. Therefore, we need to ignore any path under
//   '/:account/machines/:machineid'.
// - Instrumentations have a path of
//   '/:account/analytics/instrumentations[/:id]', which made it an special
//   case compared with the remaining resources.
function resourceName(req, res, next) {
    assert.ok(req.params.account);

    var p = req.path().split('/');
    p.shift();

    if (p[0] !== req.params.account) {
        p[0] = req.params.account;
    }


    switch (p.length) {
    case 1:
        // This is account:
        req.resourcename = util.format('/%s', p[0]);
        break;
    case 2:
        req.resourcename = '/' + p.join('/');
        break;
    case 3:
        req.resourcename = '/' + p.join('/');
        break;
    case 4:
        //  /:account/users/:user/change_password
        //
        //  /:account/users/:user/keys
        //
        //  /:login/machines/:id/snapshots
        //  /:login/machines/:id/metadata
        //  /:login/machines/:id/tags
        //  /:login/machines/:id/audit
        //  /:login/machines/:machine/fwrules
        //
        //  /:login/fwrules/:id/machines
        if (p[1] === 'users' && p[3] === 'keys') {
            req.resourcename = '/' + p.join('/');
        } else {
            req.resourcename = util.format('/%s/%s/%s', p[0], p[1], p[2]);
        }
        break;
    default:
        //  /:account/users/:user/keys/:key
        //  /:login/machines/:id/snapshots/:name
        //  ...
        //  /:login/analytics/instrumentations/:id
        //  /:login/analytics/instrumentations/:id/value/raw
        //  /:login/analytics/instrumentations/:id/value/heatmap/image
        if (p[1] === 'users' && p[3] === 'keys') {
            req.resourcename = '/' + p.join('/');
        } else if (p[1] === 'machines') {
            req.resourcename = util.format('/%s/%s/%s', p[0], p[1], p[2]);
        } else {
            req.resourcename = util.format('/%s/%s/%s/%s',
                    p[0], p[1], p[2], p[3]);
        }
        break;
    }

    return next();
}

// We only need to load the virtual resource for tagging when this is not
// an individual machine resource. When we have a machine, we'll have the
// role-tag added to the machine itself, which should be already preloaded,
// and should load the roles from the list of UUIDs the machine gives us.
function loadResource(req, res, next) {
    assert.ok(req.resourcename);
    assert.ok(req.account);
    assert.ok(req.sdc);

    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;
    req.resource = {
        name: req.resourcename,
        account: id,
        roles: []
    };

    var p = req.resourcename.split('/');
    p.shift();
    // Individual machine stores role-tag with machine:
    if (p.length > 2 && p[1] === 'machines') {
        assert.ok(req.machine);
        if (req.machine['role-tag']) {
            return membership.preloadGroups(req, req.machine['role-tag'], {
                searchby: 'uuid'
            }, function (err2, roles) {
                if (err2) {
                    return next(err2);
                }
                // Take advantage of this function to do UUID to name
                // translation for machine role-tag:
                roles.forEach(function (r) {
                    var idx = req.machine['role-tag'].indexOf(r.uuid);
                    if (idx !== -1) {
                        req.machine['role-tag'][idx] = r.name;
                    }
                });
                req.resource.roles = roles;
                return next();
            });
        } else {
            return next();
        }
    } else {
        // Everything else uses UFDS sdcResource:
        return ufds.getResource(id, req.resourcename,
                function (err, resource) {
            if (err) {
                if (err.statusCode === 404) {
                    req.log.debug('Resource %s not found', req.resourcename);
                    return next();
                } else {
                    return next(err);
                }
            } else {
                req.resource.uuid = resource.uuid;
                // If we have a resource from UFDS, we need to do the
                // memberrole.DN to role name translation.
                if (resource.memberrole) {
                    if (!Array.isArray(resource.memberrole)) {
                        resource.memberrole = [resource.memberrole];
                    }

                    return membership.preloadGroups(req, resource.memberrole, {
                        searchby: 'dn'
                    }, function (err2, roles) {
                        if (err2) {
                            return next(err2);
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
}

// TODO: We don't need to call this when saving machines.
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
        'images', 'policies', 'keys', 'datacenters',
        'analytics', 'fwrules', 'networks'
    ];

    if (validResources.indexOf(req.params.resource_name) === -1) {
        return next(new restify.ResourceNotFoundError(
                    req.params.resource_name + ' is not a valid resource'));
    }

    var entry = {
        name: util.format('/%s/%s',
                    req.account.login, req.params.resource_name),
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

    return vasync.pipeline({funcs: pipelineFuncs}, function (err, results) {
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
                    req.resource.roles.forEach(function (r2) {
                        if (r2.dn === mr) {
                            name = r2.name;
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
        name: req.resource.name || util.format('/%s/%s',
                        req.account.login, req.resourcename),
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
