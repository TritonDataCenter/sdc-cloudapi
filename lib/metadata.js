/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

var assert = require('assert-plus');
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
            owner_uuid: customer,
            origin: req.params.origin || 'cloudapi',
            creator_uuid: req.account.uuid,
            metadata: {}
        };
    var allMeta;
    var jobUUID;

    Object.keys(req.params).forEach(function (k) {
        if (/_pw$/.test(k)) {
            return;
        }
        switch (k) {
        case 'account':
        case 'machine':
        case 'uuid':
        case 'owner_uuid':
        case 'credentials':
        case 'image':
            break;
        default:
            meta.metadata[k] = req.params[k];
            break;
        }
    });

    meta.context = {
        caller: req._auditCtx
    };

    var pipeline = [
        function addMeta(_, callback) {
            vmapi.addMetadata('customer_metadata', meta, {
                headers: {
                    'x-request-id': req.getId()
                }
            }, function (err, job) {
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
            }, {
                headers: {
                    'x-request-id': req.getId()
                }
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
        // Given adding the meta info will not be immediate, let's merge it
        // with the old values so we can keep this API backwards compatible
        // with 6.5:
        Object.keys(meta.metadata).forEach(function (k) {
            if (k !== 'credentials') {
                allMeta[k] = meta.metadata[k];
            }
        });
        log.debug('POST %s -> %j', req.path(), allMeta);
        // Add an extra header intended to be used by 7.0 consumers mostly
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
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, md) {
        if (err) {
            return next(err);
        }
        // TODO: Remove in the future, around just in case any machine still
        // has credentials into customer_metadata
        if (md.credentials) {
            delete md.credentials;
        }

        if (req.params.credentials) {
            return vmapi.listMetadata('internal_metadata', {
                uuid: machine,
                owner_uuid: customer
            }, {
                headers: {
                    'x-request-id': req.getId()
                }
            }, function (err2, md2) {
                if (err2) {
                    return next(err2);
                }

                if (typeof (md2) === 'string') {
                    try {
                        md2 = JSON.parse(md2);
                    } catch (e) {}
                }

                if (Object.keys(md2).length) {
                    delete md2.locality;
                    Object.keys(md2).forEach(function (k) {
                        if (/_pw$/.test(k)) {
                            md2[k.replace(/_pw$/, '')] = md2[k];
                            delete md2[k];
                        }
                    });
                }
                md.credentials = md2;
                log.debug('GET %s -> %j', req.path(), md);
                res.send(md);
                return next();
            });
        } else {
            log.debug('GET %s -> %j', req.path(), md);
            res.send(md);
            return next();
        }

    });
}


function get(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var key = req.params.key;
    var log = req.log;
    var machine = req.params.machine;
    var vmapi = req.sdc.vmapi;

    if (key === 'credentials') {
        return vmapi.listMetadata('internal_metadata', {
            uuid: machine,
            owner_uuid: customer
        }, {
            headers: {
                'x-request-id': req.getId()
            }
        }, function (err, md) {
            if (err) {
                return next(err);
            }

            try {
                md = JSON.parse(md);
            } catch (e) {}

            if (Object.keys(md).length) {
                delete md.locality;
                Object.keys(md).forEach(function (k) {
                    if (/_pw$/.test(k)) {
                        md[k.replace(/_pw$/, '')] = md[k];
                        delete md[k];
                    }
                });
            }

            log.debug('GET %s -> %j', req.path(), md);
            res.send(md);
            return next();
        });
    } else {
        return vmapi.getMetadata('customer_metadata', key, {
            uuid: machine,
            owner_uuid: customer
        }, {
            headers: {
                'x-request-id': req.getId()
            }
        }, function (err, md) {
            if (err) {
                return next(err);
            }

            if (typeof (md) !== 'string') {
                return next(new ResourceNotFoundError(
                        '%s is not metadata', key));
            }

            log.debug('GET %s -> %s', req.path(), md);
            res.send(md);
            return next();
        });
    }
}


function del(req, res, next) {
    assert.ok(req.sdc);

    var log = req.log,
        key = req.params.key,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi;
    var customer = req.account.uuid;

    if (key === 'credentials' ||
        key === 'administrator_pw' ||
        key === 'root_authorized_keys') {
        return next(new InvalidArgumentError(
                    'Metadata key %s can not be deleted', key));
    }

    return vmapi.deleteMetadata('customer_metadata', {
        uuid: machine,
        owner_uuid: customer,
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid,
        // Audit:
        context: {
            caller: req._auditCtx
        }
    }, key, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err) {
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
        owner_uuid: customer,
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid
    }, {
        headers: {
            'x-request-id': req.getId()
        }
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

        return vmapi.setMetadata('customer_metadata', {
            metadata: new_metadata,
            uuid: machine,
            owner_uuid: customer,
            origin: req.params.origin || 'cloudapi',
            creator_uuid: req.account.uuid,
            // Audit:
            context: {
                caller: req._auditCtx
            }
        }, {
            headers: {
                'x-request-id': req.getId()
            }
        }, function (err1) {
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
    assert.object(server);
    assert.ok(before);

    server.post({
        path: '/:account/machines/:machine/metadata',
        name: 'AddMachineMetadata'
    }, before, add);

    server.get({
        path: '/:account/machines/:machine/metadata',
        name: 'ListMachineMetadata'
    }, before, list);

    server.head({
        path: '/:account/machines/:machine/metadata',
        name: 'HeadMachineMetadata'
    }, before, list);

    server.get({
        path: '/:account/machines/:machine/metadata/:key',
        name: 'GetMachineMetadata'
    }, before, get);

    server.head({
        path: '/:account/machines/:machine/metadata/:key',
        name: 'HeadMachineMetadata'
    }, before, get);

    server.del({
        path: '/:account/machines/:machine/metadata',
        name: 'DeleteAllMachineMetadata'
    }, before, delAll);

    server.del({
        path: '/:account/machines/:machine/metadata/:key',
        name: 'DeleteMachineMetadata'
    }, before, del);

    return server;
}



///--- Exports

module.exports = {
    mount: mount
};
