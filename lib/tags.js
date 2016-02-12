/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

var assert = require('assert');
var util = require('util');
var vasync = require('vasync');

var errors = require('./errors');


///--- Functions

function add(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        log = req.log,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi,
        tags = {
            uuid: machine,
            owner_uuid: customer,
            origin: req.params.origin || 'cloudapi',
            creator_uuid: req.account.uuid,
            metadata: {}
        },
        allTags,
        jobUUID;

    Object.keys(req.params).forEach(function (k) {
        switch (k) {
        case 'account':
        case 'machine':
        case 'uuid':
        case 'owner_uuid':
        case 'context':
        case 'image':
            break;
        default:
            tags.metadata[k] = req.params[k];
            break;
        }
    });

    tags.context = {
        caller: req._auditCtx,
        params: req.params
    };

    var pipeline = [
        function addTags(_, callback) {
            vmapi.addMetadata('tags', tags, {
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
        function listTags(_, callback) {
            vmapi.listMetadata('tags', {
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

                allTags = t;
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

        // Given adding the tags will not be immediate, let's merge them with
        // the old ones so we can keep this API backwards compatible with 6.5
        Object.keys(tags.metadata).forEach(function (k) {
            allTags[k] = tags.metadata[k];
        });
        log.debug('POST %s -> %j', req.path(), allTags);
        // Add an extra header intended to be used by 7.0 consumers mostly
        // TODO: Replace this with the job location instead, once we can
        // provide access to such location through Cloud API
        res.header('x-job-uuid', jobUUID);
        res.send(allTags);
        return next();

    });
}


function replace(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        log = req.log,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi,
        tags = {
            uuid: machine,
            owner_uuid: customer,
            origin: req.params.origin || 'cloudapi',
            creator_uuid: req.account.uuid,
            metadata: {}
        },
        allTags = {},
        jobUUID;

    Object.keys(req.params).forEach(function (k) {
        switch (k) {
        case 'account':
        case 'machine':
        case 'uuid':
        case 'owner_uuid':
        case 'context':
        case 'image':
            break;
        default:
            tags.metadata[k] = req.params[k];
            break;
        }
    });

    tags.context = {
        caller: req._auditCtx,
        params: req.params
    };

    vmapi.setMetadata('tags', tags, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, job) {
        if (err) {
            return next(err);
        } else {
            jobUUID = job.job_uuid;
        }

        Object.keys(tags.metadata).forEach(function (k) {
            allTags[k] = tags.metadata[k];
        });
        log.debug('PUT %s -> %j', req.path(), allTags);
        // Add an extra header intended to be used by 7.0 consumers mostly
        // TODO: Replace this with the job location instead, once we can
        // provide access to such location through Cloud API
        res.header('x-job-uuid', jobUUID);
        res.send(allTags);
        return next();
    });

}


function list(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        log = req.log,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi;

    return vmapi.listMetadata('tags', {
        uuid: machine,
        owner_uuid: customer
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, tags) {
        if (err) {
            return next(err);
        }

        log.debug('GET %s -> %j', req.path(), tags);
        res.send(tags);
        return next();
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        log = req.log,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi,
        t = req.params.tag;

    return vmapi.getMetadata('tags', t, {
        uuid: machine,
        owner_uuid: customer
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, value) {
        if (err) {
            if (err.statusCode === 404) {
                // Import VMAPI's generic 'Metadata key not found' error msg.
                next(new errors.ResourceNotFoundError(
                    err, 'tag "%s" not found', t));
            } else {
                next(errors.vmapiErrorWrap(err, 'error deleting tag'));
            }
        }

        if (typeof (value) !== 'string') {
            value = '';
        }

        log.debug('GET %s -> %s', req.path(), value);
        res.send(value);
        return next();
    });
}


function del(req, res, next) {
    assert.ok(req.sdc);

    var log = req.log,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi,
        t = req.params.tag;
    var customer = req.account.uuid;

    vmapi.deleteMetadata('tags', {
        uuid: machine,
        owner_uuid: customer,
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid,
        // Audit:
        context: {
            caller: req._auditCtx,
            params: req.params
        }
    }, encodeURIComponent(t), {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err) {
        if (err) {
            if (err.statusCode === 404) {
                // Import VMAPI's generic 'Metadata key not found' error msg.
                next(new errors.ResourceNotFoundError(
                    err, 'tag "%s" not found', t));
            } else {
                next(errors.vmapiErrorWrap(err, 'error deleting tag'));
            }
            return;
        }
        log.debug('DELETE %s -> ok', req.path());
        res.send(204);
        next();
    });
}


function delAll(req, res, next) {
    assert.ok(req.sdc);

    var log = req.log,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi;
    var customer = req.account.uuid;

    return vmapi.deleteAllMetadata('tags', {
        uuid: machine,
        owner_uuid: customer,
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid,
        // Audit:
        context: {
            caller: req._auditCtx,
            params: req.params
        }
    }, {
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


function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.post({
        path: '/:account/machines/:machine/tags',
        name: 'AddMachineTags'
    }, before, add);

    server.put({
        path: '/:account/machines/:machine/tags',
        name: 'ReplaceMachineTags'
    }, before, replace);

    server.get({
        path: '/:account/machines/:machine/tags',
        name: 'ListMachineTags'
    }, before, list);

    server.head({
        path: '/:account/machines/:machine/tags',
        name: 'HeadmachineTags'
    }, before, list);

    server.get({
        path: '/:account/machines/:machine/tags/:tag',
        name: 'GetMachineTag'
    }, before, get);

    server.head({
        path: '/:account/machines/:machine/tags/:tag',
        name: 'HeadMachineTag'
    }, before, get);

    server.del({
        path: '/:account/machines/:machine/tags',
        name: 'DeleteMachineTags'
    }, before, delAll);

    server.del({
        path: '/:account/machines/:machine/tags/:tag',
        name: 'DeleteMachineTag'
    }, before, del);

    return server;
}



///--- API

module.exports = {
    mount: mount
};
