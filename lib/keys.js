// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var restify = require('restify');



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
        key: key.openssh,
        created: key._ctime,
        updated: key._mtime
    };
}



///--- Functions

function create(req, res, next) {
    var log = req.log;
    var login = req.account.login;

    if (!req.params.key) {
        return next(new MissingParameterError('key is a required argument'));
    }

    /* BEGIN JSSTYLED */
    // if (!/^ssh-rsa.*/.test(req.params.key)) {
    //    return next(new InvalidArgumentError('Only RSA keys are supported'));
    // }
    /* END JSSTYLED */

    var obj = {
        openssh: req.params.key,
        name: req.params.name || null
    };
    return req.account.addKey(obj, function (err, key) {
        if (err) {
            return next(err);
        }

        key = translateKey(key);
        res.header('Location', sprintf('/%s/keys/%s',
                                        login,
                                        encodeURIComponent(key.fingerprint)));

        log.debug('POST %s => %j', req.path(), key);
        res.send(201, key);
        return next();
    });
}


function list(req, res, next) {
    var log = req.log;

    return req.account.listKeys(function (err, keys) {
        if (err) {
            return next(err);
        }

        keys = keys.map(translateKey);
        log.debug('GET %s => %j', req.path(), keys);
        res.send(keys);
        return next();
    });
}


function get(req, res, next) {
    var log = req.log;

    return req.account.getKey(req.params.name, function (err, key) {
        if (err) {
            return next(err);
        }

        key = translateKey(key);
        log.debug('GET %s => %j', req.path(), key);
        res.send(key);
        return next();
    });
}


function del(req, res, next) {
    var log = req.log;

    return req.account.deleteKey(req.params.name, function (err) {
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

    return server;
}



///--- API

module.exports = {
    mount: mount
};
