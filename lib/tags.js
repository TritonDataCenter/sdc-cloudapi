// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var async = require('async');



///--- Functions

function add(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var mapi = req.sdc.mapi;
    var tags = {};
    Object.keys(req.params).forEach(function (k) {
        switch (k) {
        case 'account':
        case 'machine':
            break;
        default:
            tags[k] = req.params[k];
            break;
        }
    });

    var allTags;
    async.series([
        function (callback) {
            mapi.addMachineTags(customer, machine, tags, function (err) {
                if (err)
                    return callback(err);

                return callback(null);
            });
        },
        function (callback) {
            mapi.listMachineTags(customer, machine, tags, function (err, t) {
                if (err)
                    return callback(err);

                allTags = t;
                return callback(null);
            });
        }
    ], function (err) {
        if (err)
            return next(err);

        log.debug('POST %s -> %j', req.path, allTags);
        res.send(allTags);
        return next();
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var mapi = req.sdc.mapi;

    return mapi.listMachineTags(customer, machine, function (err, tags) {
        if (err)
            return next(err);

        log.debug('GET %s -> %j', req.path, tags);
        res.send(tags);
        return next();
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var mapi = req.sdc.mapi;
    var t = req.params.tag;

    return mapi.getMachineTag(customer, machine, t, function (err, tag) {
        if (err)
            return next(err);

        if (typeof (tag.value) !== 'string')
            tag.value = '';

        log.debug('GET %s -> %s', req.path, tag);
        res.send(tag);
        return next();
    });
}


function del(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var t = req.params.tag;

    return req.sdc.mapi.deleteMachineTag(customer, machine, t, function (err) {
        if (err)
            return next(err);

        log.debug('DELETE %s -> ok', req.path);
        res.send(204);
        return next();
    });
}


function delAll(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;

    return req.sdc.mapi.deleteMachineTags(customer, machine, function (err) {
        if (err)
            return next(err);

        log.debug('DELETE %s -> ok', req.path);
        res.send(204);
        return next();
    });
}


function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.post({
        path: '/:account/machines/:machine/tags',
        name: 'AddTags'
    }, before, add);

    server.get({
        path: '/:account/machines/:machine/tags',
        name: 'ListTags'
    }, before, list);

    server.head({
        path: '/:account/machines/:machine/tags',
        name: 'HeadTags'
    }, before, list);

    server.get({
        path: '/:account/machines/:machine/tags/:tag',
        name: 'GetTag'
    }, before, get);

    server.head({
        path: '/:account/machines/:machine/tags/:tag',
        name: 'HeadTag'
    }, before, get);

    server.del({
        path: '/:account/machines/:machine/tags',
        name: 'DeleteTags'
    }, before, delAll);

    server.del({
        path: '/:account/machines/:machine/tags/:tag',
        name: 'DeleteTag'
    }, before, del);

    return server;
}



///--- API

module.exports = {
    mount: mount
};
