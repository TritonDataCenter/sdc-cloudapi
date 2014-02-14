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
var POLICY_FMT = 'policy-uuid=%s, ' + USER_FMT;

// --- Helpers


// UFDS to CloudAPI policy
function translatePolicy(policy) {
    if (!policy) {
        return {};
    }

    var r = {
        name: policy.name,
        id: policy.uuid,
        rules: policy.policydocument,
        description: policy.description
    };

    if (typeof (r.rules) === 'string') {
        r.rules = [r.rules];
    }

    return (r);
}


function parseParams(req) {
    var entry = {};

    entry.name = req.params.name;

    // TODO: Sounds reasonable to use aperture here to validate provided
    // policy documents and return the appropriated errors right here.
    if (req.params.rules) {
        try {
            entry.policydocument = JSON.parse(req.params.rules);
        } catch (e1) {
            entry.policydocument = req.params.rules;
        }
    }

    if (req.params.description) {
        entry.description = req.params.description;
    }

    return (entry);
}

// --- Functions


// Expects an array of policy names as payload, and will return an array
// of policy objects: `cb(err, policies)`
function preloadPolicies(req, names, searchby, cb) {
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
    ufds.search(dn, opts, function (err, policies) {
        if (err) {
            cb(err);
        } else {
            policies = policies.map(function (policy) {
                if (typeof (policy.policydocument) === 'string') {
                    try {
                        policy.policydocument =
                            JSON.parse(policy.policydocument);
                    } catch (e) {
                        // Do nothing ...
                    }
                }
                return (policy);
            });
            policies = policies.map(translatePolicy);
            cb(null, policies);
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

    return ufds.addPolicy(id, entry, function (err, policy) {
        if (err) {
            log.error({err: err}, 'Create policy error');
            if (err.statusCode === 409 &&
                (err.body.code === 'MissingParameter' ||
                err.body.code === 'InvalidArgument')) {
                return next(err);
            } else {
                return next(new InvalidArgumentError('policy is invalid'));
            }
        }

        policy = translatePolicy(policy);
        res.header('Location', sprintf('/%s/policies/%s',
                                    req.account.login,
                                    encodeURIComponent(policy.id)));

        log.debug('POST %s => %j', req.path(), policy);
        res.send(201, policy);
        return next();
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    return ufds.getPolicy(id, req.params.policy, function (err, policy) {
        if (err) {
            return next(err);
        }

        policy = translatePolicy(policy);
        log.debug('GET %s => %j', req.path(), policy);
        res.send(policy);
        return next();
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    return ufds.listPolicies(id, function (err, policies) {
        if (err) {
            return next(err);
        }

        policies = policies.map(translatePolicy);
        log.debug('GET %s => %j', req.path(), policies);
        res.send(policies);
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


    return ufds.modifyPolicy(id, req.params.policy, params,
            function (err, policy) {
        if (err) {
            return next(err);
        }

        policy = translatePolicy(policy);
        log.debug('POST %s => %j', req.path(), policy);
        res.send(200, policy);
        return next();

    });
}


function del(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    return ufds.deletePolicy(id, req.params.policy, function (err) {
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
        path: '/:account/policies',
        name: 'CreatePolicy',
        contentType: [
            'multipart/form-data',
            'application/octet-stream',
            'application/json',
            'text/plain'
        ]
    }, before, create);

    server.get({
        path: '/:account/policies',
        name: 'ListPolicies'
    }, before, list);

    server.head({
        path: '/:account/policies',
        name: 'HeadPolicies'
    }, before, list);

    server.get({
        path: '/:account/policies/:policy',
        name: 'GetPolicy'
    }, before, get);

    server.head({
        path: '/:account/policies/:policy',
        name: 'HeadPolicy'
    }, before, get);

    server.post({
        path: '/:account/policies/:policy',
        name: 'UpdatePolicy'
    }, before, update);

    server.del({
        path: '/:account/policies/:policy',
        name: 'DeletePolicy'
    }, before, del);

    return server;
}


// --- API

module.exports = {
    mount: mount,
    preloadPolicies: preloadPolicies
};
