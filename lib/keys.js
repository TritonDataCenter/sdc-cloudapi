/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * Note retrieving ssh keys using name instead of fingerprint
 * is deprecated since 7.2.0. (PENDING!):
 *
 * if (semver.satisfies('7.2.0', v) || semver.ltr('7.2.0', v)) {
 * }
 */

var assert = require('assert-plus');
var util = require('util');
var restify = require('restify');

var resources = require('./resources');

/// --- Globals

var sprintf = util.format;

var MissingParameterError = restify.MissingParameterError;
var InvalidArgumentError = restify.InvalidArgumentError;


///--- Helpers

function translateKey(key) {
    if (!key) {
        return {};
    }

    var obj = {
        name: key.name,
        fingerprint: key.fingerprint,
        key: key.openssh
    };

    if (key.attested === 'true') {
        obj.attested = true;

        var factors = [];
        if (key.ykpinrequired === 'true') {
            factors.push('pin');
        }
        if (key.yktouchrequired === 'true') {
            factors.push('touch');
        }
        obj.multifactor = factors;
    }

    return obj;
}



///--- Functions

function create(req, res, next) {
    var log = req.log;
    var login = req.account.login;
    var ufds = req.sdc.ufds_master;

    if (!req.params.key) {
        return next(new MissingParameterError('key is a required argument'));
    }

    if (typeof (req.params.key) !== 'string') {
        return next(new InvalidArgumentError('key must be a String'));
    }

    /* BEGIN JSSTYLED */
    // if (!/^ssh-rsa.*/.test(req.params.key)) {
    //    return next(new InvalidArgumentError('Only RSA keys are supported'));
    // }
    /* END JSSTYLED */

    // Minimal check that what we do have is an ssh key, or fail even before we
    // attempt to post to UFDS:
    var pieces = req.params.key.split(' ');
    if (!pieces || !pieces.length || pieces.length < 2) {
        return next(new InvalidArgumentError('key is invalid'));
    }

    var obj = {
        openssh: req.params.key,
        name: req.params.name || null
    };

    var attestation = req.params.attestation;
    if (attestation) {
        if (!Array.isArray(attestation)) {
            return next(new InvalidArgumentError('attestation must be an ' +
                'Array of Strings'));
        }
        var nonstrings = attestation.filter(function (elem) {
            return (typeof (elem) !== 'string');
        });
        if (nonstrings.length > 0) {
            return next(new InvalidArgumentError('attestation must be an ' +
                'Array of Strings'));
        }
        obj.attestation = attestation;
    }

    var user, account;
    if (req.params.user) {
        user = req.params.user;
        account = req.account.uuid;
    } else {
        user = req.account;
        account = '';
    }

    try {
        return ufds.addKey(user, obj, account, function (err, key) {
            if (err) {
                if (err.statusCode === 404) {
                    return next(err);
                } else {
                    log.error({err: err}, 'Create key error');

                    var msg = 'key already exists or is invalid';
                    return next(new InvalidArgumentError(msg));
                }
            }

            key = translateKey(key);
            if (account) {
                res.header('Location', sprintf('/%s/users/%s/keys/%s',
                                        login,
                                        user,
                                        encodeURIComponent(key.fingerprint)));
            } else {
                res.header('Location', sprintf('/%s/keys/%s',
                                        login,
                                        encodeURIComponent(key.fingerprint)));
            }

            if (req.headers['role-tag'] || req.activeRoles) {
                // The resource we want to save is the individual one we've
                // just created, not the collection URI:
                req.resourcename = req.resourcename + '/' + key.fingerprint;
                req.resource = {
                    name: req.resourcename,
                    account: req.account.uuid,
                    roles: []
                };
            }

            log.debug('POST %s => %j', req.path(), key);
            res.send(201, key);
            return next();
        });
    } catch (e) {
        log.error({err: e}, 'Create key exception');
        return next(new InvalidArgumentError('key is invalid'));
    }
}


function list(req, res, next) {
    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var noCache = (req.params.sync) ? true : false;
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

    return ufds.listKeys(user, account, function (err, keys) {
        if (err) {
            if (req.sdc.is_ufds_master) {
                return next(err);
            } else {
                // Fallback to local UFDS instance instead of ufds_master just
                // in case master is down:
                return req.sdc.ufds.listKeys(user, account,
                        function (err2, keys2) {
                    if (err2) {
                        return next(err2);
                    }
                    keys2 = keys2.map(translateKey);
                    log.debug('GET %s => %j', req.path(), keys2);
                    res.send(keys2);
                    return next();
                });
            }
        }

        keys = keys.map(translateKey);
        log.debug('GET %s => %j', req.path(), keys);
        res.send(keys);
        return next();
    }, noCache);
}


function get(req, res, next) {
    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var noCache = (req.params.sync) ? true : false;
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

    return ufds.getKey(user, req.params.name, account, function (err, key) {
        if (err) {
            return next(err);
        }

        key = translateKey(key);
        log.debug('GET %s => %j', req.path(), key);
        res.send(key);
        return next();
    }, noCache);
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

    return ufds.deleteKey(user, req.params.name, account, function (err) {
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
        path: '/:account/keys',
        name: 'CreateKey',
        contentType: [
            'multipart/form-data',
            'application/octet-stream',
            'application/json',
            'text/plain'
        ]
    }, before, create, resources.updateResource);

    server.get({
        path: '/:account/keys',
        name: 'ListKeys'
    }, before, list);

    server.head({
        path: '/:account/keys',
        name: 'HeadKeys'
    }, before, list);

    server.get({
        path: '/:account/keys/:name',
        name: 'GetKey'
    }, before, get);

    server.head({
        path: '/:account/keys/:name',
        name: 'HeadKey'
    }, before, get);

    server.del({
        path: '/:account/keys/:name',
        name: 'DeleteKey'
    }, before, del, resources.deleteResource);


    // Account sub users ssh keys end-points:
    server.post({
        path: '/:account/users/:user/keys',
        name: 'CreateUserKey',
        contentType: [
            'multipart/form-data',
            'application/octet-stream',
            'application/json',
            'text/plain'
        ]
    }, before, create,
    resources.updateResource);

    server.get({
        path: '/:account/users/:user/keys',
        name: 'ListUserKeys',
        version: ['7.2.0', '7.3.0', '8.0.0', '9.0.0']
    }, before, list);

    server.head({
        path: '/:account/users/:user/keys',
        name: 'HeadUserKeys',
        version: ['7.2.0', '7.3.0', '8.0.0', '9.0.0']
    }, before, list);

    server.get({
        path: '/:account/users/:user/keys/:name',
        name: 'GetUserKey',
        version: ['7.2.0', '7.3.0', '8.0.0', '9.0.0']
    }, before, get);

    server.head({
        path: '/:account/users/:user/keys/:name',
        name: 'HeadUserKey',
        version: ['7.2.0', '7.3.0', '8.0.0', '9.0.0']
    }, before, get);

    server.del({
        path: '/:account/users/:user/keys/:name',
        name: 'DeleteUserKey',
        version: ['7.2.0', '7.3.0', '8.0.0', '9.0.0']
    }, before, del, resources.deleteResource);

    return server;
}



///--- API

module.exports = {
    mount: mount
};
