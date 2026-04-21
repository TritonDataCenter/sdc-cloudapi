/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 * Copyright 2026 Edgecast Cloud LLC.
 */


var util = require('util');
var vasync = require('vasync');

var assert = require('assert-plus');
var restify = require('restify');

var resources = require('../resources');


var sprintf = util.format;

var InvalidArgumentError = restify.InvalidArgumentError;
var ForbiddenError = restify.ForbiddenError;
var InternalError = restify.InternalError;

/*
 * The intention of this limit is to be low enough to prevent spamming UFDS with
 * access keys while high enough to not be restrictive for valid use-cases.
 */
var MAX_KEYS = 100;

/**
 * @brief Maximum bucket scope entries per access key
 *
 * Bounds Redis and UFDS storage per key. Validated at
 * UFDS schema layer but also checked here for early
 * rejection.
 *
 * @since 2.2.0
 */
var MAX_SCOPE_ENTRIES = 1000;

var VALID_SCOPE_LEVELS = ['read', 'readwrite', 'full'];

/**
 * @brief Validate a scope parameter from the request
 *
 * Accepts the canonical scope envelope:
 *   {"version":1,"permissions":[{bucket,level},...]}
 *
 * Returns the canonical JSON string or null if invalid.
 *
 * Time complexity:  O(n) where n = permissions count
 * Space complexity: O(1) beyond the parsed object
 *
 * @param {Object} input - Scope envelope object
 * @return {Object} {valid: bool, scope: string|null,
 *   error: string|null}
 */
function validateScope(input) {
    if (!input || typeof input !== 'object' ||
        Array.isArray(input)) {
        return {
            valid: false,
            scope: null,
            error: 'scope: must be an object with' +
                ' version and permissions fields'
        };
    }

    var scope = input;

    if (scope.version !== 1) {
        return {
            valid: false,
            scope: null,
            error: 'scope: version must be 1'
        };
    }

    if (!Array.isArray(scope.permissions)) {
        return {
            valid: false,
            scope: null,
            error: 'scope: permissions must be an array'
        };
    }

    if (scope.permissions.length === 0) {
        return {
            valid: false,
            scope: null,
            error: 'scope: permissions array is empty'
        };
    }

    if (scope.permissions.length > MAX_SCOPE_ENTRIES) {
        return {
            valid: false,
            scope: null,
            error: 'scope: exceeds maximum of ' +
                MAX_SCOPE_ENTRIES + ' entries'
        };
    }

    // Guard against oversized scope JSON (max ~50KB)
    var scopeJson = JSON.stringify(scope);
    if (scopeJson.length > 51200) {
        return {
            valid: false,
            scope: null,
            error: 'scope: JSON exceeds 50KB size limit'
        };
    }

    for (var i = 0; i < scope.permissions.length; i++) {
        var p = scope.permissions[i];
        if (!p || typeof p !== 'object') {
            return {
                valid: false,
                scope: null,
                error: 'scope: permissions[' + i +
                    '] must be an object'
            };
        }
        if (typeof p.bucket !== 'string' ||
            p.bucket.length < 1 ||
            p.bucket.length > 63) {
            return {
                valid: false,
                scope: null,
                error: 'scope: permissions[' + i +
                    '].bucket must be 1-63 characters'
            };
        }
        /*
         * Wildcard position check: '*' is only
         * valid as the sole character or as the
         * last character of the pattern.
         */
        var starIdx = p.bucket.indexOf('*');
        if (starIdx !== -1 &&
            starIdx !== p.bucket.length - 1) {
            return {
                valid: false,
                scope: null,
                error: 'scope: permissions[' + i +
                    '].bucket: wildcard (*)' +
                    ' only allowed as last' +
                    ' character'
            };
        }
        if (VALID_SCOPE_LEVELS.indexOf(p.level) === -1) {
            return {
                valid: false,
                scope: null,
                error: 'scope: permissions[' + i +
                    '].level must be one of: ' +
                    VALID_SCOPE_LEVELS.join(', ')
            };
        }
    }

    return {
        valid: true,
        scope: scopeJson,
        error: null
    };
}


/**
 * @brief Translate UFDS access key to API response format
 *
 * Maps internal UFDS attributes to the external API
 * representation. Includes the accesskeyscope field
 * as a parsed JSON object when present.
 *
 * @param {Object} accesskey - UFDS access key entry
 * @return {Object} Translated access key for response
 */
function translateAccessKey(accesskey) {
    if (!accesskey) {
        return {};
    }

    var translated = {
       accesskeyid: accesskey.accesskeyid,
       credentialtype: accesskey.credentialtype || 'permanent'
    };

    if (accesskey.status) {
        translated.status = accesskey.status;
    } else {
        translated.status = 'Inactive';
    }

    if (accesskey.description) {
        translated.description = accesskey.description;
    }

    translated.created = new Date(Number(accesskey.created)).toISOString();

    if (accesskey.updated) {
        translated.updated = new Date(Number(accesskey.updated)).toISOString();
    } else {
        translated.updated = translated.created;
    }

    if (translated.credentialtype === 'temporary') {
        translated.expiration = accesskey.expiration;
    } else {
        translated.expiration = null;
    }

    /*
     * Return bucket scope as a parsed JSON object so
     * callers can inspect permissions directly. When
     * absent the key is unrestricted.
     */
    if (accesskey.accesskeyscope) {
        try {
            translated.scope =
                JSON.parse(accesskey.accesskeyscope);
        } catch (_e) {
            translated.scope = null;
        }
    } else {
        translated.scope = null;
    }

    return translated;
}

function create(req, res, next) {
    var log = req.log;
    var login = req.account.login;
    var ufds = req.sdc.ufds_master;

    var user, account;
    if (req.params.user) {
        user = req.params.user;
        account = req.account.uuid;
    } else {
        user = req.account;
        account = '';
    }

    var params = {};

    if (req.params.description) {
        params.description = req.params.description;
    }

    if (req.params.status) {
        params.status = req.params.status;
    }

    // access keys created by this endpoint are 'permanent' and params other
    // than status and description are ignored. However, if a client attempts to
    // create a non-permanent key, make it obvious that it isn't supported.
    if (req.params.credentialtype &&
        req.params.credentialtype !== 'permanent') {
        next(new ForbiddenError('credentialtype cannot be set via CloudAPI'));
        return;
    }

    // Make it clear that expiration cannot be set.
    if (req.params.expiration) {
        next(new ForbiddenError('expiration cannot be set via CloudAPI'));
        return;
    }

    /*
     * Per-bucket access key scoping.  Scope must be the
     * canonical envelope:
     *   {"version":1,"permissions":[{bucket,level},...]}
     *
     * Absent/null scope means unrestricted.
     */
    if (req.params.scope) {
        var result = validateScope(req.params.scope);
        if (!result.valid) {
            next(new InvalidArgumentError(result.error));
            return;
        }
        params.accesskeyscope = result.scope;
    }

    try {
        vasync.waterfall([

            function checkKeyCount(cb) {
                ufds.listAccessKeys(user, account,
                    function _listAccessKeysCb(err, keys) {
                    if (err) {
                        cb(err);
                        return;
                    }

                    // Only check the total number of permanent keys
                    var permanentKeys = keys.reduce(function (acc, key) {
                        if (!key.credentialtype ||
                            key.credentialtype === 'permanent') {
                            return acc + 1;
                        }
                        return acc;
                    }, 0);

                    if (permanentKeys >= MAX_KEYS) {
                        var errorMsg = 'Account already has the maximum ' +
                            'allowed number of access keys (' + MAX_KEYS + ')';
                        cb(new ForbiddenError(errorMsg));
                        return;
                    }
                    cb(null, keys);
                    return;
                });
            },
            function createKey(_, cb) {
                ufds.addAccessKey(user, account, params,
                    function _createKeyCb(err, accesskey) {
                    if (err) {
                        if (err.statusCode === 404) {
                            cb(err);
                            return;
                        }

                        log.error({err: err}, 'Create access key error');

                        var msg = err.message || 'key is invalid';
                        cb(new InvalidArgumentError(msg));
                        return;
                    }

                    var accesskeysecret = accesskey.accesskeysecret;

                    accesskey = translateAccessKey(accesskey);

                    // Only return the accesskeysecret on creation
                    accesskey.accesskeysecret = accesskeysecret;

                    if (account) {
                        res.header('Location',
                            sprintf('/%s/users/%s/accesskeys/%s',
                                login,
                                user,
                                encodeURIComponent(accesskey.accesskeyid)));
                    } else {
                        res.header('Location',
                            sprintf('/%s/accesskeys/%s',
                                login,
                                encodeURIComponent(accesskey.accesskeyid)));
                    }

                    if (req.headers['role-tag'] || req.activeRoles) {
                        // The resource we want to save is the individual one
                        // we've just created, not the collection URI:
                        req.resourcename = req.resourcename + '/' +
                            accesskey.accesskeyid;
                       req.resource = {
                            name: req.resourcename,
                            account: req.account.uuid,
                            roles: []
                        };
                    }

                    cb(null, accesskey);
                    return;
                });
            }

        ], function _waterfallCb(err, accesskey) {
            if (err) {
                next(err);
                return;
            }
            log.debug('POST %s => %j', req.path(), accesskey);
            res.send(201, accesskey);
            return;
        });
    } catch (e) {
        log.error({err: e}, 'create accesskey exception');
        next(new InternalError('failed to create access key'));
        return;
    }
}

function list(req, res, next) {
    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var noCache = req.params.sync;
    var user, account;
    if (req.params.user) {
        user = req.params.user;
        account = req.account.uuid;
    } else {
        user = req.account;
        account = '';
    }

    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }

    function _mapAccessKeys(accessKeys) {
        accessKeys = accessKeys.map(translateAccessKey);
        log.debug('GET %s => %j', req.path(), accessKeys);
        res.send(accessKeys);
        next();
    }

    try {
        ufds.listAccessKeys(user, account,
            function _listAccessKeysCb(err, accesskeys) {
            if (err) {
                if (req.sdc.is_ufds_master) {
                    next(err);
                    return;
                }
                // Fallback to local UFDS instance instead of ufds_master just
                // in case master is down:
                req.sdc.ufds.listAccessKeys(user, account,
                    function _listLocalAccessKeysCb(err2, accesskeys2) {
                    if (err2) {
                        next(err2);
                        return;
                    }
                    _mapAccessKeys(accesskeys2);
                    return;
                });
            }
            _mapAccessKeys(accesskeys);
        }, noCache);
    } catch (e) {
        log.error({err: e}, 'list accesskey exception');
        next(new InternalError('failed to list access keys'));
        return;
    }
}

function get(req, res, next) {
    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var noCache = req.params.sync;
    var user, account;
    if (req.params.user) {
        user = req.params.user;
        account = req.account.uuid;
    } else {
        user = req.account;
        account = '';
    }

    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }

    try {
        ufds.getAccessKey(user, req.params.accesskeyid, account,
            function _getAccessKeyCb(err, accesskey) {
            if (err) {
                next(err);
                return;
            }

            accesskey = translateAccessKey(accesskey);
            log.debug('GET %s => %j', req.path(), accesskey);
            res.send(accesskey);
            next();
            return;
        }, noCache);
    } catch (e) {
        log.error({err: e}, 'get accesskey exception');
        next(new InternalError('failed to get access keys'));
        return;
    }
}

function del(req, res, next) {
    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var user, account;
    if (req.params.user) {
        user = req.params.user;
        account = req.account.uuid;
    } else {
        user = req.account;
        account = '';
    }

    try {
        ufds.deleteAccessKey(user, req.params.accesskeyid, account,
            function _deleteAccessKeyCb(err) {
            if (err) {
                next(err);
                return;
            }

            log.debug('DELETE %s -> ok', req.path());
            res.send(204);
            next();
        });
    } catch (e) {
        log.error({err: e}, 'delete accesskey exception');
        next(new InternalError('failed to delete access keys'));
        return;
    }
}

function update(req, res, next) {
    var log = req.log;
    var login = req.account.login;
    var ufds = req.sdc.ufds_master;

    var user, account;
    if (req.params.user) {
        user = req.params.user;
        account = req.account.uuid;
    } else {
        user = req.account;
        account = '';
    }

    var params = {
        accesskeyid: req.params.accesskeyid
    };

    if (req.params.status) {
        params.status = req.params.status;
    }

    if (req.params.description) {
        params.description = req.params.description;
    }

    /*
     * Update bucket scope. An empty string removes the
     * scope (makes the key unrestricted again). A non-
     * empty value replaces the scope.
     */
    if (req.params.scope !== undefined) {
        if (req.params.scope === '' ||
            req.params.scope === null) {
            /* Remove scope: set null so UFDS deletes attr */
            params.accesskeyscope = null;
        } else {
            var scopeResult = validateScope(req.params.scope);
            if (!scopeResult.valid) {
                next(new InvalidArgumentError(
                    scopeResult.error));
                return;
            }
            params.accesskeyscope = scopeResult.scope;
        }
    }

    // Make it clear that credential type and expiration cannot be changed.
    if (req.params.credentialtype) {
        next(new ForbiddenError('credentialtype cannot be set via CloudAPI'));
        return;
    }

    if (req.params.expiration) {
        next(new ForbiddenError('expiration cannot be set via CloudAPI'));
        return;
    }

    try {
        ufds.updateAccessKey(user, account, params,
            function _updateAccessKeyCb(err, accesskey) {
            if (err) {
                var msg = err.message || 'invalid update parameters';
                next(new InvalidArgumentError(msg));
                return;
            }

            accesskey = translateAccessKey(accesskey);

            if (account) {
                res.header('Location',
                    sprintf('/%s/users/%s/accesskeys/%s',
                        login,
                        user,
                        encodeURIComponent(accesskey.accesskeyid)));
            } else {
                res.header('Location',
                    sprintf('/%s/accesskeys/%s',
                        login,
                        encodeURIComponent(accesskey.accesskeyid)));
            }

            if (req.headers['role-tag'] || req.activeRoles) {
                // The resource we want to save is the individual one we've
                // just created, not the collection URI:
                req.resourcename = req.resourcename + '/' +
                    accesskey.accesskeyid;
               req.resource = {
                    name: req.resourcename,
                    account: req.account.uuid,
                    roles: []
                };
            }

            log.debug('POST %s => %j', req.path(), accesskey);
            res.send(200, accesskey);
            next();
            return;
        });
    } catch (e) {
        log.error({err: e}, 'update accesskey exception');
        next(new InternalError('failed to update access keys'));
        return;
    }
}

function mount(server, before, config) {
    assert.object(server);
    assert.ok(before);
    assert.ok(config);

    server.post({
        path: '/:account/accesskeys',
        name: 'CreateAccessKey',
        contentType: [
            'multipart/form-data',
            'application/octet-stream',
            'application/json',
            'text/plain'
        ]
    }, before, create, resources.updateResource);

    server.get({
        path: '/:account/accesskeys',
        name: 'ListAccessKeys'
    }, before, list);

    server.head({
        path: '/:account/accesskeys',
        name: 'HeadAccessKeys'
    }, before, list);

    server.get({
        path: '/:account/accesskeys/:accesskeyid',
        name: 'GetAccessKey'
    }, before, get);

    server.head({
        path: '/:account/accesskeys/:accesskeyid',
        name: 'HeadAccessKey'
    }, before, get);

    server.del({
        path: '/:account/accesskeys/:accesskeyid',
        name: 'DeleteAccessKey'
    }, before, del, resources.deleteResource);

    server.post({
        path: '/:account/accesskeys/:accesskeyid',
        name: 'UpdateAccessKey',
        contentType: ['application/json']
    }, before, update, resources.updateResource);

    // Account sub users access keys end-points:
    server.post({
        path: '/:account/users/:user/accesskeys',
        name: 'CreateUserAccessKey',
        contentType: [
            'multipart/form-data',
            'application/octet-stream',
            'application/json',
            'text/plain'
        ]
    }, before, create,
    resources.updateResource);

    server.get({
        path: '/:account/users/:user/accesskeys',
        name: 'ListUserAccessKeys'
    }, before, list);

    server.head({
        path: '/:account/users/:user/accesskeys',
        name: 'HeadUserAccessKeys'
    }, before, list);

    server.get({
        path: '/:account/users/:user/accesskeys/:accesskeyid',
        name: 'GetUserAccessKey'
    }, before, get);

    server.head({
        path: '/:account/users/:user/accesskeys/:accesskeyid',
        name: 'HeadUserAccessKey'
    }, before, get);

    server.del({
        path: '/:account/users/:user/accesskeys/:accesskeyid',
        name: 'DeleteUserAccessKey'
    }, before, del, resources.deleteResource);

    server.post({
        path: '/:account/users/:user/accesskeys/:accesskeyid',
        name: 'UpdateUserAccessKey',
        contentType: [
            'multipart/form-data',
            'application/octet-stream',
            'application/json',
            'text/plain'
        ]
    }, before, update,
    resources.updateResource);

    return server;
}


module.exports = {
    mount: mount
};
