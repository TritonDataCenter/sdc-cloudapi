/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * This file defines routes and helpers for Account Policies.
 * These "policies" match the UFDS sdcAccountPolicy objectclass.
 *
 * Alongside the main routes and a helper to translate from
 * UFDS sdcAccountPolicy to CloudAPI policy, the file also provides
 * a method to selectively preload all of some of the account
 * policies using either the uuids or the names.
 */

var assert = require('assert');
var path = require('path');
var fs = require('fs');
var util = require('util'),
    sprintf = util.format;

var restify = require('restify'),
    MissingParameterError = restify.MissingParameterError,
    InvalidArgumentError = restify.InvalidArgumentError;
var bleedingEdge = require('./bleeding-edge'),
    guard = bleedingEdge.bleedingEdgeGuard;
var resources = require('./resources');
var aperture = require('aperture');
var apertureConfig = require('aperture-config').config;

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
        rules: policy.rule,
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

    if (req.params.rules) {
        try {
            entry.rule = JSON.parse(req.params.rules);
        } catch (e1) {
            entry.rule = req.params.rules;
        }
    }

    if (typeof (req.params.description) !== 'undefined') {
        entry.description = req.params.description;
    }

    return (entry);
}


function validApertureRules(rules) {
    var parser = aperture.createParser({
        types: aperture.types,
        typeTable: apertureConfig.typeTable
    });

    if (!Array.isArray(rules)) {
        // PUBAPI-945: Make sure we don't pass anything but strings to
        // aperture validation:
        if (typeof (rules) !== 'string') {
            rules = String(rules);
        }
        rules = [rules];
    }

    var errs = [];
    rules.forEach(function (r) {
        try {
            parser.parse(r);
        } catch (e) {
            errs.push(e.message);
        }
    });

    if (errs.length) {
        return (errs.join(', '));
    } else {
        return true;
    }
}

// --- Functions


/**
 * Preload (and cache into the request object) the given policies.
 *
 * Returns an Array of CloudAPI -UFDS- policies.
 *
 * @param {Object} req (required) the current request object.
 * @param {Array} names an array of names of the policies to retrieve. This
 *  array can contain either the names, the UUIDs or the DNs of the policies.
 * @param {Object} options optional set of search options. Notably, the
 *  @property {string} options.searchby (optional) must be provided when the
 *  given array of names contains DNs or UUIDs. For these cases, the values of
 *  options.searchby must be, respectively, 'dn' or 'uuid'.
 * @param {Function} cb callback if the form f(err, policies)
 * @throws {TypeError} on bad input.
 */
function preloadPolicies(req, names, options, cb) {
    assert.ok(req.sdc);
    assert.ok(req.account);
    assert.ok(names.length);

    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    // Avoid re-loading already loaded policies
    var cached = [];
    if (!req.cache) {
        req.cache = {};
    }
    if (!req.cache.policies) {
        req.cache.policies = {};
    }

    if (typeof (options) === 'function') {
        cb = options;
        options = {};
    }

    if (!options.searchby) {
        options.searchby = 'name';
    }

    if (options.searchby === 'dn') {
        names = names.map(function (m) {
            /* JSSTYLED */
            var RE = /^policy\-uuid=([^,]+)/;
            var res = RE.exec(m);
            if (res !== null) {
                return (res[1]);
            } else {
                return m;
            }
        });
        options.searchby = 'uuid';
    }

    // Lokup cache here, and skip policies already preloaded:
    names = names.filter(function (n) {
        if (req.cache.policies[n]) {
            cached.push(req.cache.policies[n]);
            return false;
        } else {
            return true;
        }
    });

    // At this point, if we've loaded all the policies we could return:
    if (!names.length) {
        return cb(null, cached);
    }


    var filter;

    if (names.length === 1) {
        filter = '(&(objectclass=sdcaccountpolicy)(' + options.searchby + '=' +
                    names[0] + '))';
    } else {
        filter = '(&(objectclass=sdcaccountpolicy)(|(' + options.searchby +
                    '=' + names.join(')(' + options.searchby + '=') + ')))';
    }

    var opts = {
        scope: 'one',
        filter: filter
    };

    var dn = sprintf(USER_FMT, id);
    return ufds.search(dn, opts, function (err, policies) {
        if (err) {
            cb(err);
        } else {
            policies = policies.map(translatePolicy);
            // Store into cache, just in case we may need them later:
            policies.forEach(function (u) {
                req.cache.policies[u.id] = req.cache.policies[u.name] = u;
            });
            // Finally, if we had already preloaded policies, merge here:
            if (cached.length) {
                policies = policies.concat(cached);
            }
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
    var errors = [];

    if (!req.params.name) {
        errors.push('name is required');
    }

    if (!req.params.rules) {
        errors.push('rules is required');
    }

    if (errors.length) {
        return next(new MissingParameterError(
                'Request is missing required parameters: ' +
                errors.join(', ')));
    }

    var entry = parseParams(req);
    entry.account = id;

    // Validate the provided rules:
    var validRules = validApertureRules(entry.rule);
    if (validRules !== true) {
        return next(new InvalidArgumentError(validRules));
    }

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

        if (req.headers['role-tag'] || req.activeRoles) {
            // The resource we want to save is the individual one we've
            // just created, not the collection URI:
            req.resourcename = req.resourcename + '/' + policy.id;
            req.resource = {
                name: req.resourcename,
                account: id,
                roles: []
            };
        }
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

    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }

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
    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }
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

    // Validate the provided rules:
    if (req.params.rules) {
        var validRules = validApertureRules(req.params.rules);
        if (validRules !== true) {
            return next(new InvalidArgumentError(validRules));
        }
    }

    if (params.description === '') {
        params.description = null;
    }

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


function mount(server, before, config) {
    assert.argument(server, 'object', server);
    assert.ok(before);
    assert.ok(config);

    server.post({
        path: '/:account/policies',
        name: 'CreatePolicy',
        contentType: [
            'multipart/form-data',
            'application/octet-stream',
            'application/json',
            'text/plain'
        ]
    }, guard(config, 'account_mgmt'), before, create,
    resources.updateResource);

    server.get({
        path: '/:account/policies',
        name: 'ListPolicies'
    }, guard(config, 'account_mgmt'), before, list);

    server.head({
        path: '/:account/policies',
        name: 'HeadPolicies'
    }, guard(config, 'account_mgmt'), before, list);

    server.get({
        path: '/:account/policies/:policy',
        name: 'GetPolicy'
    }, guard(config, 'account_mgmt'), before, get);

    server.head({
        path: '/:account/policies/:policy',
        name: 'HeadPolicy'
    }, guard(config, 'account_mgmt'), before, get);

    server.post({
        path: '/:account/policies/:policy',
        name: 'UpdatePolicy'
    }, guard(config, 'account_mgmt'), before, update,
    resources.updateResource);

    server.del({
        path: '/:account/policies/:policy',
        name: 'DeletePolicy'
    }, guard(config, 'account_mgmt'), before, del,
    resources.deleteResource);

    return server;
}


// --- API

module.exports = {
    mount: mount,
    preloadPolicies: preloadPolicies
};
