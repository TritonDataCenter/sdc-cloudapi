// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var vasync = require('vasync');



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
            creator_uuid: req.account.uuid
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
            break;
        default:
            tags[k] = req.params[k];
            break;
        }
    });

    tags.context = {
        caller: req._auditCtx,
        params: req.params
    };

    var pipeline = [
        function addTags(_, callback) {
            vmapi.addMetadata('tags', tags, function (err, job) {
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

        // Given adding the tags will not be immedidate, let's merge them with
        // the old ones so we can keep this API backwards compatible with 6.5
        delete tags.uuid;
        delete tags.owner_uuid;
        Object.keys(tags).forEach(function (k) {
            if (k !== 'context') {
                allTags[k] = tags[k];
            }
        });
        log.debug('POST %s -> %j', req.path(), allTags);
        // Add an extra header intended to be used by 7.0 consumers mostly
        // (shouldn't be a problem for existing 6.5 clients anyway)
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
            creator_uuid: req.account.uuid
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
            break;
        default:
            tags[k] = req.params[k];
            break;
        }
    });

    tags.context = {
        caller: req._auditCtx,
        params: req.params
    };

    vmapi.setMetadata('tags', tags, function (err, job) {
        if (err) {
            return next(err);
        } else {
            jobUUID = job.job_uuid;
        }

        delete tags.uuid;
        delete tags.owner_uuid;
        Object.keys(tags).forEach(function (k) {
            if (k !== 'context') {
                allTags[k] = tags[k];
            }
        });
        log.debug('PUT %s -> %j', req.path(), allTags);
        // Add an extra header intended to be used by 7.0 consumers mostly
        // (shouldn't be a problem for existing 6.5 clients anyway)
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
    }, function (err, value) {
        if (err) {
            return next(err);
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

    var r = {
        path: util.format('/vms/%s/%s/%s', machine, 'tags', t),
        headers: {
            'x-joyent-context': JSON.stringify({
                caller: req._auditCtx,
                params: req.params
            })
        },
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid
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

    var log = req.log,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi;

    var r = {
        path: util.format('/vms/%s/%s', machine, 'tags'),
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


function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.post({
        path: '/:account/machines/:machine/tags',
        name: 'AddTags'
    }, before, add);

    server.put({
        path: '/:account/machines/:machine/tags',
        name: 'ReplaceTags'
    }, before, replace);

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
