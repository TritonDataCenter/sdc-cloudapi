// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var async = require('async');
var restify = require('restify');


///--- Globals

var ResourceNotFoundError = restify.ResourceNotFoundError;



///--- Functions

function add(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var mapi = req.sdc.mapi;
    var meta = {};

    Object.keys(req.params).forEach(function (k) {
        switch (k) {
        case 'account':
        case 'machine':
            break;
        default:
            meta[k] = req.params[k];
            break;
        }
    });

    async.series([
        function (callback) {
            return mapi.putMachineMetadata(customer, machine, meta, callback);
        },
        function (callback) {
            return mapi.getMachine(customer, machine, callback);
        }
    ], function (err, results) {
        if (err)
            return next(err);

        var md = results[1].customer_metadata;
        if (md.credentials)
            delete md.credentials;

        log.debug('POST /%s/machines/%/metadata (%j)-> %j',
                  req.account.login, machine, meta, md);

        res.send(md);
        return next();
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var mapi = req.sdc.mapi;

    return mapi.getMachine(customer, machine, function (err, m) {
        if (err)
            return next(err);

        var md = m.customer_metadata;
        if (md.credentials)
            delete md.credentials;

        log.debug('GET /%s/machines/%/metadata -> %j)',
                  req.account.login, machine, md);

        res.send(md);
        return next();
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var key = req.params.key;
    var log = req.log;
    var machine = req.params.machine;
    var mapi = req.sdc.mapi;

    return mapi.getMachine(customer, machine, function (err, m) {
        if (err)
            return next(err);

        var md = m.customer_metadata;
        if (!md[key])
            return next(new ResourceNotFoundError('%s is not metadata'), key);

        log.debug('GET /%s/machines/%/metadata -> %j)',
                  req.account.login, machine, md[key]);

        res.send(md[key]);
        return next();
    });
}


function del(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var key = req.params.key;
    var machine = req.params.machine;
    var mapi = req.sdc.mapi;


    function callback(meta) {
        return mapi.putMachineMetadata(customer, machine, meta, function (err) {
            if (err)
                return next(err);

            log.debug('DELETE %s -> ok)', req.path);
            res.send(204);
            return next();
        });
    }

    return mapi.getMachine(customer, machine, function (err, m) {
        if (err)
            return next(err);

        var found = false;
        var md = m.customer_metadata;
        var meta = {};
        Object.keys(md).forEach(function (k) {
            if (k === key) {
                found = true;
            } else {
                meta[k] = md[k];
            }
        });

        if (!found)
            return next(new ResourceNotFoundError('%s is not metadata', key));

        return callback(meta);
    });
}


function delAll(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var mapi = req.sdc.mapi;

    return mapi.putMachineMetadata(customer, machine, {}, function (err) {
        if (err)
            return next(err);

        log.debug('DELETE /%s/machines/%/metadata -> ok)',
                  req.account.login, machine);

        res.send(204);
        return next();
    });
}


function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.post({
        path: '/:account/machines/:machine/metadata',
        name: 'AddMetadata'
    }, before, add);

    server.get({
        path: '/:account/machines/:machine/metadata',
        name: 'ListMetadata'
    }, before, list);

    server.head({
        path: '/:account/machines/:machine/metadata',
        name: 'HeadMetadata'
    }, before, list);

    server.get({
        path: '/:account/machines/:machine/metadata/:key',
        name: 'GetMetadata'
    }, before, get);

    server.head({
        path: '/:account/machines/:machine/metadata/:key',
        name: 'HeadMetadata'
    }, before, get);

    server.del({
        path: '/:account/machines/:machine/metadata',
        name: 'DeleteAllMetadata'
    }, before, delAll);

    server.del({
        path: '/:account/machines/:machine/metadata/:key',
        name: 'DeleteMetadata'
    }, before, del);

    return server;
}



///--- Exports

module.exports = {
    mount: mount
};
