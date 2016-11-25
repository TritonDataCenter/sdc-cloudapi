/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
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

var assert = require('assert-plus');
var restify = require('restify');
var vasync = require('vasync');
const { v4: uuidv4 } = require('uuid');
var clone = require('clone');
var tritonTracer = require('triton-tracer');

var membership = require('./membership');


// There are several possibilities regarding request path. The most common one
// is '/:account/:resource[/:resource_id|:resource_name]' which includes
// 'users', 'policies', 'keys', 'roles', 'datacenters', 'images', 'packages',
// 'machines', and 'fwrules'.
//
// Then, there are some special cases:
// - Account resource path is just '/:account'.
// - Sub User Keys have a nested path of the form:
//   '/:account/users/:login/keys[/:keyid]'
// - Machines may have nested resources like tags, metadata, ... On this case
//   it doesn't really matter b/c the role-tag can be added only at machine
//   level and it'll be inherited. Therefore, we need to ignore any path under
//   '/:account/machines/:machineid'.
function resourceName(req, res, next) {
    if (req.getUrl().pathname === '/--ping') {
        return next();
    }

    if (!req.accountMgmt) {
        return next();
    }
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

    req.resourcename = decodeURIComponent(req.resourcename);
    return next();
}

// We only need to load the virtual resource for tagging when this is not
// an individual machine resource. When we have a machine, we'll have the
// role-tag added to the machine itself, which should be already preloaded,
// and should load the roles from the list of UUIDs the machine gives us.
function loadResource(req, res, next) {
    if (req.getUrl().pathname === '/--ping') {
        return next();
    }
    if (!req.accountMgmt) {
        return next();
    }
    assert.ok(req.resourcename);
    assert.ok(req.account);
    assert.ok(req.sdc);

    next = tritonTracer.cls().bind(next);

    var ufds = req.sdc.ufds;
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
        if (req.machine_role_tags) {
            return membership.preloadGroups(req, req.machine_role_tags, {
                searchby: 'uuid'
            }, function (err2, roles) {
                if (err2) {
                    return next(err2);
                }
                // Take advantage of this function to do UUID to name
                // translation for machine role-tag:
                roles.forEach(function (r) {
                    var idx = req.machine_role_tags.indexOf(r.uuid);
                    if (idx !== -1) {
                        req.machine_role_tags[idx] = r.name;
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
                    req.log.debug(util.format(
                            'Resource %s not found', req.resourcename));
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

                    if (resource.memberrole.length) {
                        return membership.preloadGroups(req,
                            resource.memberrole, {
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
                } else {
                    return next();
                }
            }
        });
    }
}


function saveResource(req, cb) {
    assert.ok(req.config);
    if (!req.accountMgmt) {
        return cb(null);
    }
    assert.ok(req.resourcename);
    assert.ok(req.account);
    assert.ok(req.sdc);
    assert.ok(req.resource);

    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    if (req.params.resource_name) {
        var validResources = [
            'machines', 'users', 'roles', 'packages',
            'images', 'policies', 'keys', 'datacenters',
            'fwrules', 'networks', 'services'
        ];

        if (validResources.indexOf(req.params.resource_name) === -1) {
            return cb(new restify.ResourceNotFoundError(
                        req.params.resource_name + ' is not a valid resource'));
        }
    }

    var entry = {
        name: req.resourcename,
        account: id
    };

    if (!req.resource) {
        req.resource = entry;
    }

    var pipelineFuncs = [];
    var role_tags = req.params['role-tag'] ? req.params['role-tag'] :
        (req.headers['role-tag'] ? req.headers['role-tag'].split(',') : false);

    // We do have a list of role names that we need to translate into role DNs
    // before we save them as memberrole into sdcAccountResource:
    if (role_tags) {
        if (!Array.isArray(role_tags)) {
            role_tags = [role_tags];
        }

        pipelineFuncs.push(function _loadRoles(_, _cb) {
            if (role_tags.length) {
                membership.preloadGroups(req, role_tags, function (err, roles) {
                    if (err) {
                        _cb(err);
                    } else {
                        req.resource.roles = roles;
                        entry.roles = clone(roles);
                        _cb(null);
                    }
                });
            } else {
                req.resource.roles = entry.roles = [];
                _cb(null);
            }
        });
    } else if (req.resource.roles && req.resource.roles.length) {
        entry.roles = clone(req.resource.roles);
    } else if (req.activeRoles) {
        entry.roles = clone(req.activeRoles);
    } else {
        // this should only happen if we're not a subuser and didn't provide
        // roles in the request (see above role_tags conditional)
        req.log.warn('saveResource call w/o role tags');
        return cb(null, {
            name: entry.name,
            memberrole: []
        });
    }

    entry.uuid = req.resource.uuid ? req.resource.uuid : uuidv4();

    // req.machine can by set by loadMachine() in machine.js, if we are dealing
    // with a machine resource
    if (req.machine) {
        pipelineFuncs.push(function _translateMachineRoles(_, _cb) {
            entry.memberrole = entry.roles.map(function (r) {
                return ((r.uuid) ? r.uuid : null);
            }).filter(function (x) {
                return (x !== null);
            });
            _cb(null);
        });
    } else {
        pipelineFuncs.push(function _translateEntryRoles(_, _cb) {
            entry.memberrole = entry.roles.map(function (r) {
                return ((r.dn) ? r.dn : null);
            }).filter(function (x) {
                return (x !== null);
            });

            delete entry.roles;
            _cb(null);
        });
    }

    return vasync.pipeline({funcs: pipelineFuncs}, function (err, results) {
        if (err) {
            return cb(err);
        }
        req.log.debug({entry: entry}, 'saveResource');
        // Machines will store the role-tag themselves, everything else uses
        // sdcAccountResource, including collections:
        if (req.machine) {
            var func = (!entry.memberrole.length) ? 'deleteAllRoleTags' :
                        'setRoleTags';
            var params = {
                uuid: req.machine.id,
                owner_uuid: req.account.uuid,
                origin: req.params.origin || 'cloudapi',
                creator_uuid: req.account.uuid,
                // Audit:
                context: {
                    caller: req._auditCtx
                }
            };

            if (entry.memberrole.length) {
                params.role_tags = entry.memberrole;
            }

            return req.sdc.vmapi[func](params, {
                log: req.log,
                headers: {
                    'x-request-id': req.getId()
                }
            }, function (er, _) {
                if (er) {
                    return cb(new restify.InvalidArgumentError(
                            'Invalid role-tag'));
                }
                return cb(null, {
                    name: entry.name,
                    memberrole: entry.roles.map(function (r) {
                        return (r.name);
                    })
                });
            });
        } else {
            return ufds.modifyResource(id, entry.uuid, entry,
                function (er, resource) {
                if (er) {
                    return cb(er);
                }
                if (resource.memberrole) {
                    if (!Array.isArray(resource.memberrole)) {
                        resource.memberrole = [resource.memberrole];
                    }
                    resource.memberrole = resource.memberrole.map(
                        function (mr) {
                        var name;
                        req.resource.roles.forEach(function (r2) {
                            if (r2.dn === mr) {
                                name = r2.name;
                            }
                        });
                        return name;
                    });
                }
                return cb(null, resource);
            });
        }
    });
}


// Main intention of this function is to allow saveResource to be used from
// any other resource when saving it, in a way we can save at the same time
// the resource object and its associated role-tag.
function putResource(req, res, next) {
    if (!req.accountMgmt) {
        return next();
    }
    var log = req.log;

    return saveResource(req, function (err, resource) {
        if (err) {
            return next(err);
        }
        var r = {
            name: resource.name,
            'role-tag': resource.memberrole || []
        };
        log.debug('PUT %s -> %j', req.path(), r);
        res.send(r);
        return next();
    });
}


function updateResource(req, res, next) {
    if (!req.accountMgmt) {
        return next();
    }
    // Do nothing if the create/update operation failed:
    if (res.statusCode !== 201 && res.statusCode !== 200) {
        return next();
    }

    if (req.headers['role-tag'] || req.activeRoles) {
        return saveResource(req, function (err, resource) {
            if (err) {
                req.log.error({err: err},
                    'Error saving role-tags. Continue');
            }
            return next();
        });
    } else {
        return next();
    }
}


function getRoleTags(req, res) {
    assert.ok(req.config);
    if (!req.accountMgmt) {
        return;
    }
    assert.ok(req.resource);

    var role_tags = [];

    if (req.resource.roles) {
        req.resource.roles.forEach(function (mr) {
            role_tags.push(mr.name);
        });
    }

    if (role_tags.length) {
        res.header('role-tag', role_tags.join(','));
    }
}


function deleteResource(req, res, next) {
    assert.ok(req.config);
    if (!req.accountMgmt) {
        return next();
    }
    assert.ok(req.resourcename);
    assert.ok(req.account);
    assert.ok(req.sdc);
    assert.ok(req.resource);

    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    if (!req.resource.uuid) {
        return next();
    }

    // Do nothing if the delete operation failed:
    if (res.statusCode !== 204) {
        return next();
    }

    return ufds.deleteResource(id, req.resource.uuid, function (err) {
        if (err) {
            req.log.error({err: err}, 'Error deleting role-tags. Continue');
        }
        return next();
    });
}


// some routes need to check that a user resource actually exists, otherwise
// we end up allowing tagging of non-existent users
function checkUserExists(req, res, next) {
    if (req.params.resource_name !== 'users') {
        return next();
    }

    var ufds = req.sdc.ufds_master;
    var account = req.account.uuid;
    var user = req.params.resource_id;

    return ufds.getUser(user, account, next);
}


function mount(server, before, config) {
    assert.object(server);
    assert.ok(before);
    assert.ok(config);

    // Top level account route first
    server.put({
        path: '/:account',
        name: 'ReplaceAccountRoleTags'
    }, before, putResource);

    // So far, this would be fine for any top level list|create resource route:
    server.put({
        path: '/:account/:resource_name',
        name: 'ReplaceResourcesRoleTags'
    }, before, putResource);

    // And the special case of the sub-users keys
    server.put({
        path: '/:account/users/:user/:resource_name',
        name: 'ReplaceUserKeysResourcesRoleTags'
    }, before, putResource);

    // -- INDIVIDUAL RESOURCE ROUTES HERE:
    server.put({
        path: '/:account/:resource_name/:resource_id',
        name: 'ReplaceResourceRoleTags'
    }, before, checkUserExists, putResource);
    // We need "req.machine" (set by loadMachine in machine.js) for machines:
    server.put({
        path: '/:account/machines/:machine',
        name: 'ReplaceMachineRoleTags'
    }, before, putResource);
    // Sub User keys:
    server.put({
        path: '/:account/users/:user/keys/:resource_id',
        name: 'ReplaceUserKeysResourceRoleTags'
    }, before, putResource);

    return server;
}

module.exports = {
    loadResource: loadResource,
    resourceName: resourceName,
    getRoleTags: getRoleTags,
    saveResource: saveResource,
    deleteResource: deleteResource,
    updateResource: updateResource,
    mount: mount
};
