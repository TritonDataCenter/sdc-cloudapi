/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
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

// --- Globals

var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var SUB_USER_FMT = 'uuid=%s, ' + USER_FMT;
var ROLE_FMT = 'role-uuid=%s, ' + USER_FMT;
var POLICY_FMT = 'policy-uuid=%s, ' + USER_FMT;
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// --- Helpers

var mod_policies = require('./policies'),
    preloadPolicies = mod_policies.preloadPolicies;
var membership = require('./membership'),
    preloadGroups = membership.preloadGroups,
    preloadUsers = membership.preloadUsers,
    translateUser = membership.translateUser,
    translateGroup = membership.translateGroup;


function parseParams(req, res, next) {

    var entry = req.entry = {};

    if (req.params.name) {
        entry.name = req.params.name;
    }

    if (req.params.members) {
        try {
            entry.uniquemember = JSON.parse(req.params.members);
        } catch (e2) {
            entry.uniquemember = [req.params.members];
        }

        if (entry.uniquemember.length && Array.isArray(entry.uniquemember[0])) {
            entry.uniquemember = entry.uniquemember[0];
        }
    }

    if (req.params.policies) {
        try {
            entry.memberpolicy = JSON.parse(req.params.policies);
        } catch (e1) {
            entry.memberpolicy = [req.params.policies];
        }

        if (entry.memberpolicy.length &&
                Array.isArray(entry.memberpolicy[0])) {
            entry.memberpolicy = entry.memberpolicy[0];
        }
    }

    if (req.params.default_members) {
        try {
            entry.uniquememberdefault = JSON.parse(req.params.default_members);
        } catch (e3) {
            entry.uniquememberdefault = [req.params.default_members];
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
                if (!entry.memberpolicy) {
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
                if (!entry.uniquemember) {
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
                        if (!req.members[login]) {
                            errors.push('Invalid default role for user' +
                                login);
                            return false;
                        }
                        return (util.format(
                                SUB_USER_FMT, req.members[login].id,
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

                if (errors.length) {
                    return cb(new InvalidArgumentError(errors.join(',')));
                }

                return cb(null);
            }
        ]
    }, function (err, results) {
        if (err) {
            next(err);
        } else {
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
    }, guard(config, 'account_mgmt'), before, parseParams, create);

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
    }, guard(config, 'account_mgmt'), before, parseParams, update);

    server.del({
        path: '/:account/roles/:role',
        name: 'DeleteRole'
    }, guard(config, 'account_mgmt'), before, del);

    return server;
}

// --- API

module.exports = {
    mount: mount
};
