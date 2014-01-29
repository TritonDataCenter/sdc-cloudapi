// Copyright 2014 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var util = require('util'),
    sprintf = util.format;

var restify = require('restify'),
    MissingParameterError = restify.MissingParameterError,
    InvalidArgumentError = restify.InvalidArgumentError;


// --- Globals

var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var ROLE_FMT = 'role-uuid=%s, ' + USER_FMT;

// --- Helpers


// UFDS to CloudAPI role
function translateRole(role) {
    if (!role) {
        return {};
    }

    var r = {
        name: role.role,
        id: role.uuid,
        policy: role.policydocument,
        members: role.uniquemember,
        description: role.description
    };

    if (typeof (r.policy) === 'string') {
        r.policy = [r.policy];
    }

    if (typeof (r.members) === 'string') {
        r.members = [r.members];
    }

    return (r);
}


function parseParams(req) {
    var entry = {};

    entry.role = req.params.name;

    // TODO: Sounds reasonable to use aperture here to validate provided
    // policy documents and return the appropriated errors right here.
    if (req.params.policy) {
        try {
            entry.policydocument = JSON.parse(req.params.policy);
        } catch (e1) {
            entry.policydocument = req.params.policy;
        }
    }

    if (req.params.members) {
        try {
            entry.uniquemember = JSON.parse(req.params.members);
        } catch (e2) {
            entry.uniquemember = req.params.members;
        }
    }

    if (req.params.description) {
        entry.description = req.params.description;
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

    return ufds.addRole(id, entry, function (err, role) {
        if (err) {
            log.error({err: err}, 'Create role error');
            if (err.statusCode === 409 &&
                (err.body.code === 'MissingParameter' ||
                err.body.code === 'InvalidArgument')) {
                return next(err);
            } else {
                return next(new InvalidArgumentError('role is invalid'));
            }
        }

        role = translateRole(role);
        res.header('Location', sprintf('/%s/roles/%s',
                                    req.account.login,
                                    encodeURIComponent(role.id)));

        log.debug('POST %s => %j', req.path(), role);
        res.send(201, role);
        return next();
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    return ufds.getRole(id, req.params.role, function (err, role) {
        if (err) {
            return next(err);
        }

        role = translateRole(role);
        log.debug('GET %s => %j', req.path(), role);
        res.send(role);
        return next();
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    return ufds.listRoles(id, function (err, roles) {
        if (err) {
            return next(err);
        }

        roles = roles.map(translateRole);
        log.debug('GET %s => %j', req.path(), roles);
        res.send(roles);
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


    return ufds.modifyRole(id, req.params.role, params, function (err, role) {
        if (err) {
            return next(err);
        }

        role = translateRole(role);
        log.debug('POST %s => %j', req.path(), role);
        res.send(200, role);
        return next();

    });
}


function del(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    return ufds.deleteRole(id, req.params.role, function (err) {
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
        path: '/:account/roles',
        name: 'CreateRole',
        contentType: [
            'multipart/form-data',
            'application/octet-stream',
            'application/json',
            'text/plain'
        ]
    }, before, create);

    server.get({
        path: '/:account/roles',
        name: 'ListRoles'
    }, before, list);

    server.head({
        path: '/:account/roles',
        name: 'HeadRoles'
    }, before, list);

    server.get({
        path: '/:account/roles/:role',
        name: 'GetRole'
    }, before, get);

    server.head({
        path: '/:account/roles/:role',
        name: 'HeadRole'
    }, before, get);

    server.post({
        path: '/:account/roles/:role',
        name: 'UpdateRole'
    }, before, update);

    server.del({
        path: '/:account/roles/:role',
        name: 'DeleteRole'
    }, before, del);

    return server;
}


// --- API

module.exports = {
    mount: mount
};
