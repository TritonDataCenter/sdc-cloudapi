// Copyright 2014 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var util = require('util'),
    sprintf = util.format;

var restify = require('restify'),
    MissingParameterError = restify.MissingParameterError,
    InvalidArgumentError = restify.InvalidArgumentError;


// --- Globals

var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var SUB_USER_FMT = 'uuid=%s, ' + USER_FMT;
var ROLE_FMT = 'policy-uuid=%s, ' + USER_FMT;

// --- Helpers


// UFDS to CloudAPI role
function translateRole(role) {
    if (!role) {
        return {};
    }

    var r = {
        name: role.name,
        id: role.uuid,
        policy: role.policydocument,
        description: role.description
    };

    if (typeof (r.policy) === 'string') {
        r.policy = [r.policy];
    }

    return (r);
}


function parseParams(req) {
    var entry = {};

    entry.name = req.params.name;

    // TODO: Sounds reasonable to use aperture here to validate provided
    // policy documents and return the appropriated errors right here.
    if (req.params.policy) {
        try {
            entry.policydocument = JSON.parse(req.params.policy);
        } catch (e1) {
            entry.policydocument = req.params.policy;
        }
    }

    if (req.params.description) {
        entry.description = req.params.description;
    }

    return (entry);
}

// --- Functions


// Expects an array of role names as payload, and will return an array
// of role objects: `cb(err, roles)`
function preloadRoles(req, names, searchby, cb) {
    assert.ok(req.sdc);
    assert.ok(req.account);
    assert.ok(names.length);

    if (typeof (searchby) === 'function') {
        cb = searchby;
        searchby = 'name';
    }

    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;
    var filter;

    if (names.length === 1) {
        filter = '(&(objectclass=sdcaccountpolicy)(' + searchby + '=' +
                    names[0] + '))';
    } else {
        filter = '(&(objectclass=sdcaccountpolicy)(|(' + searchby + '=' +
                    names.join(')(' + searchby + '=') + ')))';
    }

    var opts = {
        scope: 'one',
        filter: filter
    };

    var dn = sprintf(USER_FMT, id);
    ufds.search(dn, opts, function (err, roles) {
        if (err) {
            cb(err);
        } else {
            roles = roles.map(function (role) {
                if (typeof (role.policydocument) === 'string') {
                    try {
                        role.policydocument = JSON.parse(role.policydocument);
                    } catch (e) {
                        // Do nothing ...
                    }
                }
                return (role);
            });
            roles = roles.map(translateRole);
            cb(null, roles);
        }
    });
}


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

    return ufds.addPolicy(id, entry, function (err, role) {
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

    return ufds.getPolicy(id, req.params.role, function (err, role) {
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

    return ufds.listPolicies(id, function (err, roles) {
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


    return ufds.modifyPolicy(id, req.params.role, params, function (err, role) {
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

    return ufds.deletePolicy(id, req.params.role, function (err) {
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
    mount: mount,
    preloadRoles: preloadRoles
};
