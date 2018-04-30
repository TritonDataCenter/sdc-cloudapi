/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
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

var assert = require('assert-plus');

var util = require('util'),
    sprintf = util.format;

var vasync = require('vasync');
var restify = require('restify'),
    MissingParameterError = restify.MissingParameterError,
    InvalidArgumentError = restify.InvalidArgumentError;
var bleedingEdge = require('./bleeding-edge'),
    guard = bleedingEdge.bleedingEdgeGuard;

var semver = require('semver');

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
    var i, j;
    var entry = {};

    if (semver.gtr('9.0.0', req.getVersion())) {
        parseParams_old(req, res, next);
        return;
    }

    if (params.name) {
        if (typeof (params.name) !== 'string') {
            next(new InvalidArgumentError('Role "name" must be a string'));
            return;
        }
        entry.name = params.name;
    }

    if (params.policies) {
        if (!Array.isArray(params.policies)) {
            next(new InvalidArgumentError('Role "policies" must be an array ' +
                'of objects'));
            return;
        }
        for (i = 0; i < params.policies.length; ++i) {
            var policy = params.policies[i];
            if (typeof (policy) !== 'object' || policy === null ||
                Array.isArray(policy)) {

                next(new InvalidArgumentError('Role "policies" must be an ' +
                    'array of objects'));
                return;
            }
            var keys = Object.keys(policy);
            for (j = 0; j < keys.length; ++j) {
                switch (keys[j]) {
                case 'id':
                    if (typeof (policy.id) !== 'string' ||
                        !UUID_RE.test(policy.id)) {
                        next(new InvalidArgumentError('Policy "id" ' +
                            'property must be a string UUID'));
                        return;
                    }
                    break;
                case 'name':
                    if (typeof (policy.name) !== 'string') {
                        next(new InvalidArgumentError('Policy "name" ' +
                            'property must be a string'));
                        return;
                    }
                    break;
                default:
                    next(new InvalidArgumentError('Policy references may ' +
                        'only contain "name" or "id" properties, not ' +
                        '"' + keys[j] + '"'));
                    return;
                }
            }
        }
        entry.policies = params.policies;
    }

    if (params.members) {
        if (!Array.isArray(params.members)) {
            next(new InvalidArgumentError('Role "members" must be an array ' +
                'of objects'));
            return;
        }
        for (i = 0; i < params.members.length; ++i) {
            var member = params.members[i];
            if (typeof (member) !== 'object' || member === null ||
                Array.isArray(member)) {

                next(new InvalidArgumentError('Role "members" must be an ' +
                    'array of objects'));
                return;
            }
            if (typeof (member.type) !== 'string') {
                next(new InvalidArgumentError('Role "member" references must ' +
                    'have a string "type" property'));
                return;
            }
            switch (member.type) {
            case 'subuser':
            case 'account':
                break;
            default:
                next(new InvalidArgumentError('Member "type" is not ' +
                    'supported: "' + member.type + '"'));
                return;
            }
            keys = Object.keys(member);
            for (j = 0; j < keys.length; ++j) {
                switch (keys[j]) {
                case 'type':
                    break;
                case 'id':
                    if (typeof (member.id) !== 'string' ||
                        !UUID_RE.test(member.id)) {
                        next(new InvalidArgumentError('Member "id" ' +
                            'property must be a string UUID'));
                        return;
                    }
                    break;
                case 'login':
                    if (typeof (member.login) !== 'string') {
                        next(new InvalidArgumentError('Member "login" ' +
                            'property must be a string'));
                        return;
                    }
                    break;
                case 'default':
                    if (typeof (member.default) !== 'boolean') {
                        next(new InvalidArgumentError('Member "default" ' +
                            'property must be a boolean'));
                        return;
                    }
                    break;
                default:
                    next(new InvalidArgumentError('Member references may ' +
                        'only contain "type", "login", "id", or "default" ' +
                        'properties, not "' + keys[j] + '"'));
                    return;
                }
            }
        }
        entry.members = params.members;
    }

    fetchParamsData(entry, req, res, next);
}

function parseParams_old(req, res, next) {
    var params = req.params;
    var entry  = {};
    var memberLookup = {};

    if (params.name) {
        entry.name = params.name;
    }

    if (params.members) {
        var members;
        if (typeof (params.members) === 'string') {
            try {
                members = JSON.parse(params.members);
            } catch (e) {}
        }

        if (!members) {
            members = [params.members];
        }

        if (members.length && Array.isArray(members[0])) {
            members = members[0];
        }

        entry.members = [];
        members.forEach(function _addNormalMember(login) {
            if (!memberLookup[login]) {
                var m = { type: 'subuser', login: login, default: false };
                memberLookup[login] = m;
                entry.members.push(m);
            }
        });
    }

    if (params.default_members) {
        var defaults;
        if (typeof (params.default_members) === 'string') {
            try {
                defaults = JSON.parse(params.default_members);
            } catch (e) {}
        }

        if (!defaults) {
            defaults = [params.default_members];
        }

        if (defaults.length && Array.isArray(defaults[0])) {
            defaults = defaults[0];
        }

        if (!entry.members) {
            entry.members = [];
        }

        defaults.forEach(function _addDefaultMember(login) {
            var m;
            if (memberLookup[login]) {
                m = memberLookup[login];
            } else {
                m = { type: 'subuser', login: login };
                memberLookup[login] = m;
                entry.members.push(m);
            }
            m.default = true;
        });
    }

    if (params.policies) {
        var policies;
        if (typeof (params.policies) === 'string') {
            try {
                policies = JSON.parse(params.policies);
            } catch (e) {}
        }

        if (!policies) {
            policies = [params.policies];
        }

        if (policies.length && Array.isArray(policies[0])) {
            policies = policies[0];
        }
        // It could be possible to give it the empty string, which may cause us
        // some trouble:
        if (policies[0] === '') {
            policies = [];
        }

        entry.policies = [];
        policies.forEach(function _addPolicy(name) {
            var p = { name: name };
            entry.policies.push(p);
        });
    }

    fetchParamsData(entry, req, res, next);
}

function fetchParamsData(entry, req, res, next) {
    vasync.pipeline({
        funcs: [
            function _getPoliciesByName(_, cb) {
                if (!entry.policies) {
                    return cb(null);
                }
                var lookup = {};
                entry.policies.forEach(function _addNameToLookup(p) {
                    if (p.name) {
                        lookup[p.name] = p;
                    }
                });
                var keys = Object.keys(lookup);
                if (!keys.length) {
                    return cb(null);
                }
                return preloadPolicies(req, keys,
                    function (err, policies) {
                    if (err) {
                        return cb(err);
                    }
                    policies.forEach(function _annotatePolicyByName(r) {
                        var p = lookup[r.name];
                        if (p) {
                            p.info = r;
                            p.dn = util.format(POLICY_FMT, r.id,
                                req.account.uuid);
                        }
                    });
                    return cb(null);
                });
            },
            function _getPoliciesById(_, cb) {
                var lookup = {};
                if (!entry.policies) {
                    return cb(null);
                }
                entry.policies.forEach(function _addIdToLookup(p) {
                    if (p.id && !p.dn) {
                        lookup[p.id] = p;
                    }
                });
                var keys = Object.keys(lookup);
                if (!keys.length) {
                    return cb(null);
                }
                return preloadPolicies(req, keys, { searchby: 'uuid' },
                    function (err, policies) {
                    if (err) {
                        return cb(err);
                    } else {
                        policies.forEach(function _annotatePolicyById(r) {
                            var p = lookup[r.id];
                            if (p) {
                                p.info = r;
                                p.dn = util.format(POLICY_FMT, r.id,
                                    req.account.uuid);
                            }
                        });
                        return cb(null);
                    }
                });
            },
            function _getSubusers(_, cb) {
                if (!entry.members) {
                    cb(null);
                    return;
                }
                var subusers = entry.members.filter(function (m) {
                    return (m.type === 'subuser');
                });
                vasync.forEachParallel({
                    inputs: subusers,
                    func: function _getSubuser(m, ccb) {
                        function _afterGetSubuser(err, i) {
                            if (err) {
                                ccb();
                                return;
                            }
                            m.info = i;
                            m.dn = util.format(SUB_USER_FMT,
                                i.user.uuid, i.account.uuid);
                            ccb();
                        }
                        if (m.id) {
                            req.sdc.mahi.getUserById(m.id, _afterGetSubuser);
                        } else if (m.login) {
                            req.sdc.mahi.getUser(m.login, req.account.login,
                                false, _afterGetSubuser);
                        }
                    }
                }, cb);
            },
            function _getAccounts(_, cb) {
                if (!entry.members) {
                    cb(null);
                    return;
                }
                var accounts = entry.members.filter(function (m) {
                    return (m.type === 'account');
                });
                vasync.forEachParallel({
                    inputs: accounts,
                    func: function _getAccount(m, ccb) {
                        function _afterGetAccount(err, i) {
                            if (err) {
                                ccb();
                                return;
                            }
                            m.info = i;
                            m.dn = util.format(USER_FMT, i.account.uuid);
                            ccb();
                        }
                        if (m.id) {
                            req.sdc.mahi.getAccountById(m.id, _afterGetAccount);
                        } else if (m.login) {
                            req.sdc.mahi.getAccount(m.login, _afterGetAccount);
                        }
                    }
                }, cb);
            },

            function _verifyParams(_, cb) {
                var errors = [];
                if (entry.name && entry.name === 'true') {
                    errors.push('"true" is not a valid role name');
                }
                if (entry.members) {
                    var members = entry.members;

                    members.forEach(function _checkMemberAnnotation(m) {
                        if (!m.info || !m.dn) {
                            if (m.id) {
                                errors.push('Invalid ' + m.type + ': ' + m.id);
                            } else if (m.login) {
                                errors.push('Invalid ' + m.type + ': ' +
                                    m.login);
                            } else {
                                /* We should never get here */
                                errors.push('Invalid member: ' +
                                    JSON.stringify(m));
                            }
                        }
                    });

                    delete (entry.members);
                    entry.uniquemember = members.map(function (m) {
                        return (m.dn);
                    });
                    entry.uniquememberdefault = members.filter(function (m) {
                        return (m.default);
                    }).map(function (m) {
                        return (m.dn);
                    });
                }
                if (entry.policies) {
                    var policies = entry.policies;

                    if (entry.name === ADMIN_ROLE_NAME) {
                        errors.push('Administrator role cannot have policies');
                    }

                    policies.forEach(function _checkPolicyAnnotation(p) {
                        if (!p.info || !p.dn) {
                            if (p.id) {
                                errors.push('Invalid policy: ' + p.id);
                            } else if (p.name) {
                                errors.push('Invalid policy: ' + p.name);
                            } else {
                                errors.push('Invalid policy: ' +
                                    JSON.stringify(p));
                            }
                        }
                    });

                    delete (entry.policies);
                    entry.memberpolicy = policies.map(function (p) {
                        return (p.dn);
                    });
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
        if (group1.name === ADMIN_ROLE_NAME &&
            (params.memberpolicy || params.policies)) {

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
    assert.object(server);
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
    }, before, parseParams,
    create, resources.updateResource);

    server.get({
        path: '/:account/roles',
        name: 'ListRoles'
    }, before, list);

    server.head({
        path: '/:account/roles',
        name: 'HeadRoles'
    }, before, list);

    server.get({
        path: '/:account/roles/:role',
        name: 'GetRole'
    }, before, get);

    server.head({
        path: '/:account/roles/:role',
        name: 'HeadRole'
    }, before, get);

    server.post({
        path: '/:account/roles/:role',
        name: 'UpdateRole'
    }, before, parseParams,
    update, resources.updateResource);

    server.del({
        path: '/:account/roles/:role',
        name: 'DeleteRole'
    }, before, del,
    resources.deleteResource);

    return server;
}

// --- API

module.exports = {
    mount: mount
};
