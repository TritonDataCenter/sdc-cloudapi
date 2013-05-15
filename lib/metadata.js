// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var vasync = require('vasync');
var restify = require('restify');


///--- Globals

var ResourceNotFoundError = restify.ResourceNotFoundError;
var InvalidArgumentError = restify.InvalidArgumentError;


///--- Functions

function add(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var vmapi = req.sdc.vmapi;
    var meta = {
            uuid: machine,
            owner_uuid: customer
        };
    var allMeta;
    var jobUUID;

    Object.keys(req.params).forEach(function (k) {
        switch (k) {
        case 'account':
        case 'machine':
        case 'uuid':
        case 'owner_uuid':
        case 'credentials':
            break;
        default:
            meta[k] = req.params[k];
            break;
        }
    });

    meta.context = {
        caller: req._auditCtx,
        params: req.params
    };

    var pipeline = [
        function addMeta(_, callback) {
            vmapi.addMetadata('customer_metadata', meta, function (err, job) {
                if (err) {
                    return callback(err);
                } else {
                    jobUUID = job.job_uuid;
                }

                return callback(null);
            });
        },
        function listMeta(_, callback) {
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
    ];

    vasync.pipeline({
        funcs: pipeline
    }, function (err, results) {
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
            if (k !== 'credentials') {
                allMeta[k] = meta[k];
            }
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

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var vmapi = req.sdc.vmapi;

    return vmapi.listMetadata('customer_metadata', {
        uuid: machine,
        owner_uuid: customer
    }, function (err, md) {
        if (err) {
            return next(err);
        }
        // TODO: Remove in the future, around just in case any machine still
        // has credentials into customer_metadata
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

    var customer = req.account.uuid;
    var key = req.params.key;
    var log = req.log;
    var machine = req.params.machine;
    var vmapi = req.sdc.vmapi;
    var w = (key === 'credentials') ? 'internal_metadata' : 'customer_metadata';

    return vmapi.getMetadata(w, key, {
        uuid: machine,
        owner_uuid: customer
    }, function (err, md) {
        if (err) {
            return next(err);
        }

        if (typeof (md) !== 'string') {
            return next(new ResourceNotFoundError('%s is not metadata'), key);
        }

        if (key === 'credentials') {
            try {
                md = JSON.parse(md);
            } catch (e) {}

            if (Object.keys(md).length) {
                Object.keys(md).forEach(function (k) {
                    if (/_pw$/.test(k)) {
                        md[k.replace(/_pw$/, '')] =
                            md[k];
                        delete md[k];
                    }
                });
            }
        }

        log.debug('GET %s -> %s', req.path(), md);
        res.send(md);
        return next();
    });
}


function del(req, res, next) {
    assert.ok(req.sdc);

    var log = req.log,
        key = req.params.key,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi;

    if (key === 'credentials' ||
        key === 'administrator_pw' ||
        key === 'root_authorized_keys') {
        return next(new InvalidArgumentError(
                    'Metadata key %s can not be deleted', key));
    }

    var r = {
        path: util.format('/vms/%s/%s/%s', machine, 'customer_metadata', key),
        headers: {
            'x-joyent-context': JSON.stringify({
                caller: req._auditCtx,
                params: req.params
            })
        }
    };

    return vmapi.client.del(r, function (err, req1, res1) {
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

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var vmapi = req.sdc.vmapi;
    var new_metadata = {
        uuid: machine,
        owner_uuid: customer
    };

    return vmapi.listMetadata('customer_metadata', {
        uuid: machine,
        owner_uuid: customer
    }, function (err, md) {
        if (err) {
            return next(err);
        }

        if (md.administrator_pw) {
            new_metadata.administrator_pw = md.administrator_pw;
        }

        if (md.root_authorized_keys) {
            new_metadata.root_authorized_keys = md.root_authorized_keys;
        }

        return vmapi.setMetadata('customer_metadata', new_metadata,
            function (err1) {
            if (err1) {
                return next(err1);
            }

            log.debug('DELETE %s -> ok', req.path());
            res.send(204);
            return next();
        });
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
