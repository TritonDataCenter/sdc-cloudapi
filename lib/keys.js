// Copyright 2014 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var restify = require('restify');

// TODO: Remove once account management is out of Beta.
var bledingEdge = require('./bleeding-edge'),
    guard = bledingEdge.bleedingEdgeGuard;


/// --- Globals

var sprintf = util.format;

var MissingParameterError = restify.MissingParameterError;
var InvalidArgumentError = restify.InvalidArgumentError;


///--- Helpers

function translateKey(key) {
    if (!key) {
        return {};
    }

    return {
        name: key.name,
        fingerprint: key.fingerprint,
        key: key.openssh
    };
}



///--- Functions

function create(req, res, next) {
    var log = req.log;
    var login = req.account.login;
    var ufds = req.sdc.ufds_master;

    if (!req.params.key) {
        return next(new MissingParameterError('key is a required argument'));
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

    var user, account;
    if (req.params.user) {
        user = req.params.user;
        account = req.account.uuid;
    } else {
        user = req.account;
        account = '';
    }

    try {
        return ufds.addKey(user, obj, account,
                function (err, key) {
            if (err) {
                log.error({err: err}, 'Create key error');
                return next(new InvalidArgumentError('key is invalid'));
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

    return ufds.listKeys(user, account, function (err, keys) {
        if (err) {
            return next(err);
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
    assert.argument(server, 'object', server);
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
    }, before, create);

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
    }, before, del);


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
    }, guard(config, 'account_mgmt'), before, create);

    server.get({
        path: '/:account/users/:user/keys',
        name: 'ListUserKeys',
        version: ['7.2.0']
    }, guard(config, 'account_mgmt'), before, list);

    server.head({
        path: '/:account/users/:user/keys',
        name: 'HeadUserKeys',
        version: ['7.2.0']
    }, guard(config, 'account_mgmt'), before, list);

    server.get({
        path: '/:account/users/:user/keys/:name',
        name: 'GetUserKey',
        version: ['7.2.0']
    }, guard(config, 'account_mgmt'), before, get);

    server.head({
        path: '/:account/users/:user/keys/:name',
        name: 'HeadUserKey',
        version: ['7.2.0']
    }, guard(config, 'account_mgmt'), before, get);

    server.del({
        path: '/:account/users/:user/keys/:name',
        name: 'DeleteUserKey',
        version: ['7.2.0']
    }, guard(config, 'account_mgmt'), before, del);

    return server;
}



///--- API

module.exports = {
    mount: mount
};
