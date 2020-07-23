/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */


var util = require('util');

var assert = require('assert-plus');
var jsprim = require('jsprim');
var restify = require('restify');

var resources = require('../resources');


var sprintf = util.format;

var InvalidArgumentError = restify.InvalidArgumentError;

function translateAccessKey(accesskey) {
    if (!accesskey) {
        return {};
    }

    var obj = jsprim.deepCopy(accesskey);
    obj.created = new Date(Number(accesskey.created)).toISOString();

    obj.status = 'Active';

    return obj;
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

    try {
        ufds.addAccessKey(user, account, function (err, accesskey) {
            if (err) {
                if (err.statusCode === 404) {
                    next(err);
                    return;
                }

                log.error({err: err}, 'Create access key error');

                var msg = 'key is invalid';
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
            res.send(201, accesskey);
            next();
            return;
        });
    } catch (e) {
        log.error({err: e}, 'Create accesskey exception');
        next(new InvalidArgumentError('accesskey is invalid'));
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

    ufds.deleteAccessKey(user, req.params.accesskeyid, account, function (err) {
        if (err) {
            next(err);
            return;
        }

        log.debug('DELETE %s -> ok', req.path());
        res.send(204);
        next();
    });
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


    // Account sub users ssh keys end-points:
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

    return server;
}


module.exports = {
    mount: mount
};
