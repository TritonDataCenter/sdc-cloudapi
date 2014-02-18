/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * This file defines routes and helpers for Account Roles.
 * These "roles" match the UFDS sdcAccountGroup objectclass.
 *
 * Alongside the main routes and a helper to translate from
 * UFDS sdcAccountGroup to CloudAPI role, the file also provides
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


// --- Globals

var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var SUB_USER_FMT = 'uuid=%s, ' + USER_FMT;
var GROUP_FMT = 'group-uuid=%s, ' + USER_FMT;
var POLICY_FMT = 'policy-uuid=%s, ' + USER_FMT;
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// --- Helpers

var mod_policies = require('./policies'),
    preloadPolicies = mod_policies.preloadPolicies;
var mod_users = require('./users'),
    preloadUsers = mod_users.preloadUsers;


// UFDS group to CloudAPI role
function translateGroup(req, group, cb) {
    assert.ok(req.sdc);

    var pipeline_funcs = [];
    var r = {
        name: group.cn,
        id: group.uuid,
        members: group.uniquemember || [],
        policies: group.memberpolicy || []
    };

    if (typeof (r.members) === 'string') {
        r.members = [r.members];
    }

    if (typeof (r.policies) === 'string') {
        r.policies = [r.policies];
    }

    if (r.members.length) {
        pipeline_funcs.push(function _dn2uuid(_, _cb) {
            r.members = r.members.map(function (m) {
                /* JSSTYLED */
                var RE = /^uuid=([^,]+)/;
                var res = RE.exec(m);
                if (res !== null) {
                    return (res[1]);
                } else {
                    return m;
                }
            });
            return _cb(null);
        });
        pipeline_funcs.push(function _loadMembers(_, _cb) {
            preloadUsers(req, r.members, 'uuid', function (err, users) {
                if (err) {
                    return _cb(err);
                }
                r.members = users;
                return _cb(null);
            });
        });
    }


    if (r.policies.length) {
        pipeline_funcs.push(function _rdn2uuid(_, _cb) {
            r.policies = r.policies.map(function (m) {
                /* JSSTYLED */
                var RE = /^policy\-uuid=([^,]+)/;
                var res = RE.exec(m);
                if (res !== null) {
                    return (res[1]);
                } else {
                    return m;
                }
            });
            return _cb(null);
        });
        pipeline_funcs.push(function _loadPolicies(_, _cb) {
            preloadPolicies(req, r.policies, 'uuid', function (err, policies) {
                if (err) {
                    return _cb(err);
                }
                r.policies = policies;
                return _cb(null);
            });
        });
    }


    if (pipeline_funcs.length) {
        pipeline_funcs.push(function _translate(_, _cb) {
            r.policies = r.policies.map(function (policy) {
                return (policy.name);
            });
            r.members = r.members.map(function (member) {
                return (member.login);
            });
            return _cb(null);
        });

        vasync.pipeline({
            funcs: pipeline_funcs
        }, function (err, results) {
            if (err) {
                return cb(err);
            }
            return cb(null, r);
        });
    } else {
        cb(null, r);
    }
}


function parseParams(req, res, next) {

    var entry = req.entry = {};

    if (req.params.name) {
        entry.cn = req.params.name;
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

        if (entry.memberpolicy.length && Array.isArray(entry.memberpolicy[0])) {
            entry.memberpolicy = entry.memberpolicy[0];
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

    return ufds.addGroup(id, entry, function (err, group1) {
        if (err) {
            log.error({err: err}, 'Create group error');
            if (err.statusCode === 409 &&
                (err.body.code === 'MissingParameter' ||
                err.body.code === 'InvalidArgument')) {
                return next(err);
            } else {
                return next(new InvalidArgumentError('group is invalid'));
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

    return ufds.getGroup(id, req.params.role, function (err1, group1) {
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

    return ufds.listGroups(id, function (err, groups) {
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

    return ufds.getGroup(id, req.params.role, function (err1, group1) {
        if (err1) {
            return next(err1);
        }
        return ufds.modifyGroup(id, group1.uuid, params,
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

    return ufds.deleteGroup(id, req.params.role, function (err) {
        if (err) {
            return next(err);
        }

        log.debug('DELETE %s -> ok', req.path());
        res.send(204);
        return next();
    });
}


function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.post({
        path: '/:account/roles',
        name: 'CreateRole',
        contentType: [
            'multipart/form-data',
            'application/octet-stream',
            'application/json',
            'text/plain'
        ]
    }, before, parseParams, create);

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
    }, before, parseParams, update);

    server.del({
        path: '/:account/roles/:role',
        name: 'DeleteRole'
    }, before, del);

    return server;
}

// --- API

module.exports = {
    mount: mount
};
