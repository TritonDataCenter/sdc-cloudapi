/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * This file defines routes and helpers for Account Roles.
 * These "roles" match the UFDS sdcAccountGroup objectclass.
 *
 * See membership.js for a helper to translate from
 * UFDS sdcAccountGroup to CloudAPI role; the file also provides
 * a method to selectively preload all of some of the account
 * roles using either the uuids or the names.
 *
 * Please, note that the `translateGroup` function is performing
 * the translation from sdcAccountUsers DNs to members login and
 * from Policies DN to their respective names. These translations
 * will need some time but it's acceptable, since customers wouldn't
 * be hitting these auth control routes with the frequency they may
 * do for other routes like listMachines.
 */

var assert = require('assert');

var util = require('util'),
    sprintf = util.format;

var vasync = require('vasync');
var restify = require('restify'),
    MissingParameterError = restify.MissingParameterError,
    InvalidArgumentError = restify.InvalidArgumentError;
var bleedingEdge = require('./bleeding-edge'),
    guard = bleedingEdge.bleedingEdgeGuard;

var resources = require('./resources');

// --- Globals

var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var SUB_USER_FMT = 'uuid=%s, ' + USER_FMT;
var ROLE_FMT = 'role-uuid=%s, ' + USER_FMT;
var POLICY_FMT = 'policy-uuid=%s, ' + USER_FMT;
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

var ADMIN_ROLE_NAME = 'administrator';

// --- Helpers

var mod_policies = require('./policies'),
    preloadPolicies = mod_policies.preloadPolicies;
var membership = require('./membership'),
    preloadUsers = membership.preloadUsers,
    translateUser = membership.translateUser,
    translateGroup = membership.translateGroup;


function parseParams(req, res, next) {
    var params = req.params;
    var entry  = {};

    if (params.name) {
        entry.name = params.name;
    }

    if (params.members) {
        if (typeof (params.members) === 'string') {
            try {
                entry.uniquemember = JSON.parse(params.members);
            } catch (e) {}
        }

        if (!entry.uniquemember) {
            entry.uniquemember = [params.members];
        }

        if (entry.uniquemember.length && Array.isArray(entry.uniquemember[0])) {
            entry.uniquemember = entry.uniquemember[0];
        }
    }

    if (params.policies) {
        if (typeof (params.members) === 'string') {
            try {
                entry.memberpolicy = JSON.parse(params.policies);
            } catch (e) {}
        }

        if (!entry.memberpolicy) {
            entry.memberpolicy = [params.policies];
        }

        if (entry.memberpolicy.length && Array.isArray(entry.memberpolicy[0])) {
            entry.memberpolicy = entry.memberpolicy[0];
        }
        // It could be possible to give it the empty string, which may cause us
        // some trouble:
        if (entry.memberpolicy[0] === '') {
            entry.memberpolicy = [];
        }
    }

    if (params.default_members) {
        if (typeof (params.default_members) === 'string') {
            try {
                entry.uniquememberdefault = JSON.parse(params.default_members);
            } catch (e) {}
        }

        if (!entry.uniquememberdefault) {
            entry.uniquememberdefault = [params.default_members];
        }

        if (entry.uniquememberdefault.length &&
                Array.isArray(entry.uniquememberdefault[0])) {
            entry.uniquememberdefault = entry.uniquememberdefault[0];
        }
    }

    vasync.pipeline({
        funcs: [
            function _getPolicies(_, cb) {
                req.policies = {};
                if (typeof (entry.memberpolicy) === 'number') {
                    entry.memberpolicy = [String(entry.memberpolicy)];
                }
                if (!entry.memberpolicy || !entry.memberpolicy.length) {
                    return cb(null);
                }
                return preloadPolicies(req, entry.memberpolicy,
                    function (err, policies) {
                    if (err) {
                        return cb(err);
                    } else {
                        policies.map(function (r) {
                            req.policies[r.name] = r;
                        });
                        return cb(null);
                    }
                });
            },
            function _getMembers(_, cb) {
                req.members = {};
                if (!entry.uniquemember || !entry.uniquemember.length) {
                    return cb(null);
                }
                return preloadUsers(req, entry.uniquemember,
                        function (err, members) {
                    if (err) {
                        return cb(err);
                    } else {
                        members.map(function (m) {
                            req.members[m.login] = m;
                        });
                        return cb(null);
                    }
                });
            },
            function _getDefaultMembers(_, cb) {
                req.defaultmembers = {};
                if (!entry.uniquememberdefault ||
                        !entry.uniquememberdefault.length) {
                    return cb(null);
                }
                return preloadUsers(req, entry.uniquememberdefault,
                        function (err, members) {
                    if (err) {
                        return cb(err);
                    } else {
                        members.map(function (m) {
                            req.defaultmembers[m.login] = m;
                        });
                        return cb(null);
                    }
                });
            },

            function _verifyParams(_, cb) {
                var errors = [];
                if (entry.name && entry.name === 'true') {
                    errors.push('"true" is not a valid role name');
                }
                if (entry.uniquemember) {
                    entry.uniquemember =
                        entry.uniquemember.map(function (login) {
                        if (!req.members[login]) {
                            errors.push('Invalid user ' + login);
                            return false;
                        }
                        return (util.format(
                                SUB_USER_FMT, req.members[login].id,
                                req.account.uuid));
                    });
                }
                if (entry.uniquememberdefault) {
                    entry.uniquememberdefault =
                        entry.uniquememberdefault.map(function (login) {
                        if (!req.defaultmembers[login]) {
                            errors.push('Invalid default role for user ' +
                                login);
                            return false;
                        }
                        return (util.format(
                                SUB_USER_FMT, req.defaultmembers[login].id,
                                req.account.uuid));
                    });
                }
                if (entry.memberpolicy) {
                    entry.memberpolicy =
                        entry.memberpolicy.map(function (policy) {
                        if (!req.policies[policy]) {
                            errors.push('Invalid policy ' + policy);
                            return false;
                        }

                        return (util.format(
                                POLICY_FMT, req.policies[policy].id,
                                req.account.uuid));
                    });
                }

                if (entry.memberpolicy && entry.name === ADMIN_ROLE_NAME) {
                    errors.push('Administrator role cannot have policies');
                }

                if (errors.length) {
                    return cb(new InvalidArgumentError(errors.join(', ')));
                }

                return cb(null);
            }
        ]
    }, function (err, results) {
        if (err) {
            next(err);
        } else {
            req.entry = entry;
            next();
        }
    });
}

// --- Functions


function create(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    if (!req.params.name) {
        return next(new MissingParameterError(
                    'Request is missing required parameter: name'));
    }

    var entry = req.entry;
    entry.account = id;

    return ufds.addRole(id, entry, function (err, group1) {
        if (err) {
            log.error({err: err}, 'Create role error');
            if (err.statusCode === 409 &&
                (err.body.code === 'MissingParameter' ||
                err.body.code === 'InvalidArgument')) {
                return next(err);
            } else {
                return next(new InvalidArgumentError('role is invalid'));
            }
        }
        return translateGroup(req, group1, function (err2, group) {
            if (err2) {
                return next(err2);
            }

            if (req.headers['role-tag'] || req.activeRoles) {
                // The resource we want to save is the individual one we've
                // just created, not the collection URI:
                req.resourcename = req.resourcename + '/' + group.id;
                req.resource = {
                    name: req.resourcename,
                    account: id,
                    roles: []
                };
            }
            res.header('Location', sprintf('/%s/roles/%s',
                                    req.account.login,
                                    encodeURIComponent(group.id)));

            log.debug('POST %s => %j', req.path(), group);
            res.send(201, group);
            return next();
        });
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }

    return ufds.getRole(id, req.params.role, function (err1, group1) {
        if (err1) {
            return next(err1);
        }
        return translateGroup(req, group1, function (err, group) {
            if (err) {
                return next(err);
            }
            log.debug('GET %s => %j', req.path(), group);
            res.send(group);
            return next();
        });
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;
    var grps = [];

    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }

    return ufds.listRoles(id, function (err, groups) {
        if (err) {
            return next(err);
        }

        return vasync.forEachPipeline({
            func: function (group, cb) {
                translateGroup(req, group, function (err2, grp) {
                    if (err) {
                        return cb(err2);
                    }
                    grps.push(grp);
                    return cb(null);
                });
            },
            inputs: groups
        }, function (error, results) {
            if (error) {
                return next(error);
            }
            log.debug('GET %s => %j', req.path(), grps);
            res.send(grps);
            return next();
        });
    });
}


function update(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    var params = req.entry;

    return ufds.getRole(id, req.params.role, function (err1, group1) {
        if (err1) {
            return next(err1);
        }
        if (group1.name === ADMIN_ROLE_NAME && params.memberpolicy) {
            return next(new InvalidArgumentError(
                    'Administrator role cannot have policies'));
        }
        return ufds.modifyRole(id, group1.uuid, params,
                function (err2, group2) {
            if (err2) {
                return next(err2);
            }
            return translateGroup(req, group2, function (err, group) {
                if (err) {
                    return next(err);
                }
                log.debug('POST %s => %j', req.path(), group);
                res.send(group);
                return next();
            });
        });
    });
}


function del(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    return ufds.deleteRole(id, req.params.role, function (err) {
        if (err) {
            return next(err);
        }

        log.debug('DELETE %s -> ok', req.path());
        res.send(204);
        return next();
    });
}


function mount(server, before, config) {
    assert.argument(server, 'object', server);
    assert.ok(before);
    assert.ok(config);

    server.post({
        path: '/:account/roles',
        name: 'CreateRole',
        contentType: [
            'multipart/form-data',
            'application/octet-stream',
            'application/json',
            'text/plain'
        ]
    }, guard(config, 'account_mgmt'), before, parseParams,
    create, resources.updateResource);

    server.get({
        path: '/:account/roles',
        name: 'ListRoles'
    }, guard(config, 'account_mgmt'), before, list);

    server.head({
        path: '/:account/roles',
        name: 'HeadRoles'
    }, guard(config, 'account_mgmt'), before, list);

    server.get({
        path: '/:account/roles/:role',
        name: 'GetRole'
    }, guard(config, 'account_mgmt'), before, get);

    server.head({
        path: '/:account/roles/:role',
        name: 'HeadRole'
    }, guard(config, 'account_mgmt'), before, get);

    server.post({
        path: '/:account/roles/:role',
        name: 'UpdateRole'
    }, guard(config, 'account_mgmt'), before, parseParams,
    update, resources.updateResource);

    server.del({
        path: '/:account/roles/:role',
        name: 'DeleteRole'
    }, guard(config, 'account_mgmt'), before, del,
    resources.deleteResource);

    return server;
}

// --- API

module.exports = {
    mount: mount
};
