// Copyright 2014 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var util = require('util'),
    sprintf = util.format;

var restify = require('restify'),
    MissingParameterError = restify.MissingParameterError,
    InvalidArgumentError = restify.InvalidArgumentError;


// --- Globals

var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var GROUP_FMT = 'group-uuid=%s, ' + USER_FMT;

// --- Helpers


// UFDS to CloudAPI group
function translateGroup(group) {
    if (!group) {
        return {};
    }

    var r = {
        name: group.cn,
        id: group.uuid,
        members: group.uniquemember
    };

    if (typeof (r.members) === 'string') {
        r.members = [r.members];
    }

    return (r);
}


function parseParams(req) {
    var entry = {};

    entry.cn = req.params.name;

    if (req.params.members) {
        try {
            entry.uniquemember = JSON.parse(req.params.members);
        } catch (e2) {
            entry.uniquemember = req.params.members;
        }
    }

    return (entry);
}

// --- Functions


function create(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    if (!req.params.name) {
        return next(new MissingParameterError(
                    'Request is missing required parameter: name'));
    }

    var entry = parseParams(req);
    entry.account = id;

    return ufds.addGroup(id, entry, function (err, group) {
        if (err) {
            log.error({err: err}, 'Create group error');
            if (err.statusCode === 409 &&
                (err.body.code === 'MissingParameter' ||
                err.body.code === 'InvalidArgument')) {
                return next(err);
            } else {
                return next(new InvalidArgumentError('group is invalid'));
            }
        }

        group = translateGroup(group);
        res.header('Location', sprintf('/%s/groups/%s',
                                    req.account.login,
                                    encodeURIComponent(group.id)));

        log.debug('POST %s => %j', req.path(), group);
        res.send(201, group);
        return next();
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    return ufds.getGroup(id, req.params.group, function (err, group) {
        if (err) {
            return next(err);
        }

        group = translateGroup(group);
        log.debug('GET %s => %j', req.path(), group);
        res.send(group);
        return next();
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    return ufds.listGroups(id, function (err, groups) {
        if (err) {
            return next(err);
        }

        groups = groups.map(translateGroup);
        log.debug('GET %s => %j', req.path(), groups);
        res.send(groups);
        return next();

    });
}


function update(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    var params = parseParams(req);
    params.id = id;


    return ufds.modifyGroup(id, req.params.group, params,
        function (err, group) {
        if (err) {
            return next(err);
        }

        group = translateGroup(group);
        log.debug('POST %s => %j', req.path(), group);
        res.send(200, group);
        return next();

    });
}


function del(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    return ufds.deleteGroup(id, req.params.group, function (err) {
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
        path: '/:account/groups',
        name: 'CreateGroup',
        contentType: [
            'multipart/form-data',
            'application/octet-stream',
            'application/json',
            'text/plain'
        ]
    }, before, create);

    server.get({
        path: '/:account/groups',
        name: 'ListGroups'
    }, before, list);

    server.head({
        path: '/:account/groups',
        name: 'HeadGroups'
    }, before, list);

    server.get({
        path: '/:account/groups/:group',
        name: 'GetGroup'
    }, before, get);

    server.head({
        path: '/:account/groups/:group',
        name: 'HeadGroup'
    }, before, get);

    server.post({
        path: '/:account/groups/:group',
        name: 'UpdateGroup'
    }, before, update);

    server.del({
        path: '/:account/groups/:group',
        name: 'DeleteGroup'
    }, before, del);

    return server;
}


// --- API

module.exports = {
    mount: mount
};
