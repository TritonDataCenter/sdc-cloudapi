// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var async = require('async');
var restify = require('restify');


///--- Globals

var ResourceNotFoundError = restify.ResourceNotFoundError;



///--- Functions

function add(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        log = req.log,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi,
        meta = {
            uuid: machine,
            owner_uuid: customer
        },
        allMeta,
        jobUUID;

    Object.keys(req.params).forEach(function (k) {
        switch (k) {
        case 'account':
        case 'machine':
        case 'uuid':
        case 'owner_uuid':
            break;
        default:
            meta[k] = req.params[k];
            break;
        }
    });

    async.series([
        function (callback) {
            vmapi.addMetadata('customer_metadata', meta, function (err, job) {
                if (err) {
                    return callback(err);
                } else {
                    jobUUID = job.job_uuid;
                }

                return callback(null);
            });
        },
        function (callback) {
            vmapi.listMetadata('customer_metadata', {
                uuid: machine,
                owner_uuid: customer
            }, function (err, t) {
                if (err) {
                    return callback(err);
                }

                allMeta = t;
                return callback(null);
            });
        }
    ], function (err, results) {
        if (err) {
            return next(err);
        }

        if (allMeta.credentials) {
            delete allMeta.credentials;
        }
        // Given adding the meta info will not be immedidate, let's merge it
        // with the old values so we can keep this API backwards compatible
        // with 6.5:
        delete meta.uuid;
        delete meta.owner_uuid;
        Object.keys(meta).forEach(function (k) {
            allMeta[k] = meta[k];
        });
        log.debug('POST %s -> %j', req.path(), allMeta);
        // Add an extra header intended to be used by 7.0 consumers mostly
        // (shouldn't be a problem for existing 6.5 clients anyway)
        // TODO: Replace this with the job location instead, once we can
        // provide access to such location through Cloud API
        res.header('x-job-uuid', jobUUID);
        res.send(allMeta);
        return next();
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        log = req.log,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi;

    return vmapi.listMetadata('customer_metadata', {
        uuid: machine,
        owner_uuid: customer
    }, function (err, md) {
        if (err) {
            return next(err);
        }

        if (md.credentials) {
            delete md.credentials;
        }
        log.debug('GET %s -> %j', req.path(), md);
        res.send(md);
        return next();
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        key = req.params.key,
        log = req.log,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi;

    return vmapi.getMetadata('customer_metadata', key, {
        uuid: machine,
        owner_uuid: customer
    }, function (err, md) {
        if (err) {
            return next(err);
        }

        if (typeof (md) !== 'string') {
            return next(new ResourceNotFoundError('%s is not metadata'), key);
        }

        log.debug('GET %s -> %s', req.path(), md);
        res.send(md);
        return next();
    });
}


function del(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        log = req.log,
        key = req.params.key,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi;

    return vmapi.deleteMetadata('customer_metadata', {
        uuid: machine,
        owner_uuid: customer
    }, key, function (err) {
        if (err) {
            return next(err);
        }

        log.debug('DELETE %s -> ok', req.path());
        res.send(204);
        return next();
    });
}


function delAll(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        log = req.log,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi;

    return vmapi.deleteAllMetadata('customer_metadata', {
        uuid: machine,
        owner_uuid: customer
    }, function (err) {
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
