/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * This file defines routes and helpers for Account Users.
 * These "users" match the UFDS sdcAccountUser objectclass.
 *
 * See membership.js for a helper to translate from
 * UFDS sdcAccountUser to CloudAPI user; the file also provides
 * a method to selectively preload all of some of the account
 * users using either the DNs, uuids or the login names.
 *
 */

var assert = require('assert-plus');

var util = require('util'),
    sprintf = util.format;

var restify = require('restify'),
    MissingParameterError = restify.MissingParameterError,
    InvalidArgumentError = restify.InvalidArgumentError;

var vasync = require('vasync');

var translateUser = require('./membership').translateUser;

var resources = require('./resources');

// --- Globals

/* eslint-disable max-len */
/* BEGIN JSSTYLED */
var EMAIL_RE = /^[a-zA-Z0-9.!#$%&amp;'*+\-/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
/* END JSSTYLED */
/* eslint-enable max-len */

var USER_FMT = 'uuid=%s, ou=users, o=smartdc';

// --- Helpers



// Intentionally skipping userpassword here:
function parseParams(req) {
    var modifiableProps = ['email', 'cn', 'sn', 'company', 'address', 'city',
        'state', 'postalCode', 'country', 'phone', 'givenName', 'login'];

    var params = {};
    modifiableProps.forEach(function (p) {
        if (typeof (req.params[p]) !== 'undefined') {
            params[p] = (req.params[p] === '') ? null : req.params[p];
        }
    });
    // We change these, check them too:
    if (typeof (req.params.companyName) !== 'undefined') {
        params.company = (req.params.companyName === '') ?
            null : req.params.companyName;
    }

    if (typeof (req.params.firstName) !== 'undefined') {
        params.givenName = (req.params.firstName === '') ?
            null : req.params.firstName;
    }

    if (typeof (req.params.lastName) !== 'undefined') {
        params.sn = (req.params.lastName === '') ?
            null : req.params.lastName;
    }

    if (params.givenName && params.sn) {
        params.cn = params.givenName + ' ' + params.sn;
    }

    return (params);
}


function updateUser(ufds, userUuid, accountUuid, params, cb) {
    var queryGet = {
        searchType: 'uuid',
        value: userUuid,
        account: accountUuid
    };

    ufds.getUserEx(queryGet, function (err, user) {
        if (err) {
            return cb(err);
        }

        return ufds.updateUser(user, params, function (err2) {
            if (err2) {
                return cb(err2);
            }

            return ufds.getUserEx(queryGet, cb);
        });
    });
}



// --- Functions



function create(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;
    var errors = [];

    var params = parseParams(req);
    if (!params.email) {
        errors.push('email is required');
    }

    if (req.params.login) {
        params.login = req.params.login;
    } else {
        errors.push('login is required');
    }

    if (req.params.password) {
        params.userpassword = req.params.password;
    } else {
        errors.push('password is required');
    }

    // Fail early:
    if (errors.length) {
        return next(new MissingParameterError(
                'Request is missing required parameters: ' +
                errors.join(', ')));
    }

    // I'd say we should do this at UFDS level but, while we don't make a
    // decission, let's go for it here (see CAPI-120):
    if (!EMAIL_RE.test(params.email)) {
        return next(new InvalidArgumentError('email: ' + params.email +
                ' is invalid'));
    }

    // Important bit here!:
    params.account = id;

    return ufds.addUser(params, function (err, user) {
        if (err) {
            log.error({err: err}, 'Create user error');
            if (err.statusCode === 409 &&
                (err.body.code === 'MissingParameter' ||
                err.body.code === 'InvalidArgument')) {
                var msg = err.message;
                if (/userpassword/.test(msg)) {
                    err.message = msg.replace(/userpassword/g, 'password');
                }
                return next(err);
            } else {
                return next(new InvalidArgumentError('user is invalid'));
            }
        }

        user = translateUser(user);
        if (req.headers['role-tag'] || req.activeRoles) {
            // The resource we want to save is the individual one we've
            // just created, not the collection URI:
            req.resourcename = req.resourcename + '/' + user.id;
            req.resource = {
                name: req.resourcename,
                account: id,
                roles: []
            };
        }
        res.header('Location', sprintf('/%s/users/%s',
                                    req.account.login,
                                    encodeURIComponent(user.login)));

        log.debug('POST %s => %j', req.path(), user);
        res.send(201, user);
        return next();
    });
}


function update(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var accUuid = req.account.uuid;

    var params = parseParams(req);
    // I'd say we should do this at UFDS level but, while we don't make a
    // decission, let's go for it here (see CAPI-120):
    if (params.email && !EMAIL_RE.test(params.email)) {
        return next(new InvalidArgumentError('email: ' + params.email +
                ' is invalid'));
    }

    var userUuid = req.params.uuid;

    return updateUser(ufds, userUuid, accUuid, params, function (err, user) {
        if (err) {
            return next(err);
        }

        user = translateUser(user);

        log.debug('POST %s => %j', req.path(), user);
        res.send(200, user);
        return next();
    });
}


function changePassword(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var accUuid = req.account.uuid;
    var errors = [];
    var params = {};

    if (req.params.password) {
        params.userpassword = req.params.password;
    } else {
        errors.push('password is required');
    }

    if (!req.params.password_confirmation) {
        errors.push('password_confirmation is required');
    }

    // Fail early:
    if (errors.length) {
        return next(new MissingParameterError(
                'Request is missing required parameters: ' +
                errors.join(', ')));
    }

    if (req.params.password !== req.params.password_confirmation) {
        return next(new InvalidArgumentError('password and ' +
                    'password_confirmation must have the same value'));
    }

    var userUuid = req.params.uuid;

    return updateUser(ufds, userUuid, accUuid, params, function (err, user) {
        if (err) {
            return next(err);
        }

        user = translateUser(user);

        log.debug('POST %s => %j', req.path(), user);
        res.send(200, user);
        return next();
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;
    var dn = sprintf(USER_FMT, id);

    var opts = {
        scope: 'one',
        filter: '(objectclass=sdcaccountuser)'
    };

    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }

    return ufds.search(dn, opts, function (err, users) {
        if (err) {
            return next(err);
        }

        users = users.map(translateUser);
        log.debug('GET %s => %j', req.path(), users);
        res.send(users);
        return next();
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

    return ufds.getUser(req.params.uuid, id, function (err, user) {
        if (err) {
            return next(err);
        }

        return vasync.pipeline({
            funcs: [function mapGroups(_, cb) {
                if (!req.params.membership) {
                    return cb(null);
                }
                var roles = [];
                var default_roles = [];
                return user.roles(function (er2, rs) {
                    if (er2) {
                        return cb(er2);
                    }
                    roles = rs.map(function (r) {
                        return (r.name);
                    });
                    user.roles = roles;
                    return user.defaultRoles(function (er3, dr) {
                        if (er3) {
                            return cb(er3);
                        }
                        default_roles = dr.map(function (r) {
                            return (r.name);
                        });
                        user.default_roles = default_roles;
                        return cb(null);
                    });
                });
            }
        ]
        }, function (error, results) {
            if (error) {
                return next(error);
            }
            user = translateUser(user);
            log.debug('GET %s => %j', req.path(), user);
            res.send(user);
            return next();
        });
    });
}


function del(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    return ufds.deleteUser(req.params.uuid, id, function (err) {
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
        path: '/:account/users',
        name: 'CreateUser',
        contentType: [
            'multipart/form-data',
            'application/octet-stream',
            'application/json',
            'text/plain'
        ]
    }, before, create,
    resources.updateResource);

    server.get({
        path: '/:account/users',
        name: 'ListUsers'
    }, before, list);

    server.head({
        path: '/:account/users',
        name: 'HeadUsers'
    }, before, list);

    server.get({
        path: '/:account/users/:uuid',
        name: 'GetUser'
    }, before, get);

    server.head({
        path: '/:account/users/:uuid',
        name: 'HeadUser'
    }, before, get);

    server.post({
        path: '/:account/users/:uuid',
        name: 'UpdateUser'
    }, before, update,
    resources.updateResource);

    server.post({
        path: '/:account/users/:uuid/change_password',
        name: 'ChangeUserPassword'
    }, before, changePassword);

    server.del({
        path: '/:account/users/:uuid',
        name: 'DeleteUser'
    }, before, del,
    resources.deleteResource);

    return server;
}


// --- API

module.exports = {
    mount: mount
};
