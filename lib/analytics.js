/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * CloudAPI Cloud Analytics 1.0 Resource.
 */

var assert = require('assert');
var util = require('util');

var restify = require('restify');



///--- Globals

var sprintf = util.format;
var InvalidArgumentError = restify.InvalidArgumentError;

/* JSSTYLED */
var URI_REGEX = /\/ca\/customers\/[\w]{8}(-[\w]{4}){3}-[\w]{12}\//;

var resources = require('./resources');

///--- Helpers

function translate(val, login) {
    assert.ok(val);
    assert.ok(login);

    var _uri = '/' + login + '/analytics/';

    if (val.uri) {
        delete val.uri;
    }

    if (val.uris) {
        val.uris.forEach(function (u) {
            if (u.uri) {
                u.uri = u.uri.replace(URI_REGEX, _uri);
            }
        });
    }

    return val;
}


function getParams(req) {
    assert.ok(req);

    var params = {};
    Object.keys(req.params).forEach(function (k) {
        switch (k) {
        case 'account':
        case 'id':
            break;
        default:
            params[k] = req.params[k];
            break;
        }
    });

    return params;
}



///--- Functions

function describe(req, res, next) {
    assert.ok(req.sdc);

    var ca = req.sdc.ca;
    var customer = req.account.uuid;
    var log = req.log;

    if (req.rbacFeatureEnabled) {
        resources.getRoleTags(req, res);
    }

    return ca.describe(customer, function (err, metrics) {
        if (err) {
            return next(err);
        }

        log.debug('GET %s -> %j', req.path(), metrics);
        res.send(metrics);
        return next();
    });
}


function create(req, res, next) {
    assert.ok(req.sdc);

    var ca = req.sdc.ca;
    var customer = req.account.uuid;
    var log = req.log;
    var login = req.account.login;
    var params = getParams(req);

    return ca.createInstrumentation(customer, params, function (err, inst) {
        if (err) {
            return next(err);
        }

        inst = translate(inst, login);
        if (req.headers['role-tag'] || req.activeRoles) {
            // The resource we want to save is the individual one we've
            // just created, not the collection URI:
            req.resourcename = req.resourcename + '/' + inst.id;
            req.resource = {
                name: req.resourcename,
                account: req.account.uuid,
                roles: []
            };
        }
        res.header('Location', sprintf('/%s/analytics/instrumentations/%s',
                                        login,
                                        inst.id));
        log.debug('POST %s -> %j', req.path(), inst);
        res.send(inst);
        return next();
    });
}


function clone(req, res, next) {
    assert.ok(req.sdc);

    if (req.params.action !== 'clone') {
        return next(new InvalidArgumentError('%s is not a valid action',
                                                req.params.action));
    }

    var ca = req.sdc.ca;
    var customer = req.account.uuid;
    var id = req.params.id;
    var log = req.log;
    var login = req.account.login;
    var params = getParams(req);

    return ca.cloneInstrumentation(customer, id, params, function (err, inst) {
        if (err) {
            return next(err);
        }

        inst = translate(inst, login);
        var locat = sprintf('/%s/analytics/instrumentations/%s',
                                        login,
                                        inst.id);
        if (req.headers['role-tag'] || req.activeRoles) {
            // The resource we want to save is the one we've
            // just created, not the one we clone:
            req.resourcename = locat;
            req.resource = {
                name: req.resourcename,
                account: req.account.uuid,
                roles: []
            };
        }
        res.header('Location', locat);
        log.debug('POST %s -> %j', req.path(), inst);
        res.send(inst);
        return next();
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);

    var ca = req.sdc.ca;
    var customer = req.account.uuid;
    var log = req.log;
    var login = req.account.login;

    if (req.rbacFeatureEnabled) {
        resources.getRoleTags(req, res);
    }

    return ca.listInstrumentations(customer, function (err, insts) {
        if (err) {
            return next(err);
        }

        var _insts = [];
        insts.forEach(function (i) {
            _insts.push(translate(i, login));
        });

        log.debug('GET %s -> %j', req.path(), _insts);
        res.send(_insts);
        return next();
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);

    var ca = req.sdc.ca;
    var customer = req.account.uuid;
    var id = req.params.id;
    var log = req.log;
    var login = req.account.login;

    return ca.getInstrumentation(customer, id, function (err, inst) {
        if (err) {
            return next(err);
        }
        if (req.rbacFeatureEnabled) {
            resources.getRoleTags(req, res);
        }
        inst = translate(inst, login);

        log.debug('GET %s -> %j', req.path(), inst);
        res.send(inst);
        return next();
    });
}


function getValue(req, res, next) {
    assert.ok(req.sdc);

    var ca = req.sdc.ca;
    var customer = req.account.uuid;
    var id = req.params.id;
    var log = req.log;
    var login = req.account.login;
    var params = getParams(req);

    return ca.getInstrumentationValue(customer, id, params, function (err, v) {
        if (err) {
            return next(err);
        }

        v = translate(v, login);

        log.debug('GET %s -> %j', req.path(), v);
        res.send(v);
        return next();
    });
}


function heatmap(req, res, next) {
    assert.ok(req.sdc);

    var ca = req.sdc.ca;
    var customer = req.account.uuid;
    var id = req.params.id;
    var log = req.log;
    var login = req.account.login;
    var params = getParams(req);

    return ca.getHeatmap(customer, id, params, function (err, hmap) {
        if (err) {
            return next(err);
        }

        hmap = translate(hmap, login);

        log.debug('GET %s -> %j', req.path(), hmap);
        res.send(hmap);
        return next();
    });
}


function heatmapDetails(req, res, next) {
    assert.ok(req.sdc);

    var ca = req.sdc.ca;
    var customer = req.account.uuid;
    var id = req.params.id;
    var log = req.log;
    var login = req.account.login;
    var params = getParams(req);

    return ca.getHeatmapDetails(customer, id, params, function (err, hmap) {
        if (err) {
            return next(err);
        }

        hmap = translate(hmap, login);

        log.debug('GET %s -> %j', req.path(), hmap);
        res.send(hmap);
        return next();
    });
}


function del(req, res, next) {
    assert.ok(req.sdc);

    var ca = req.sdc.ca;
    var customer = req.account.uuid;
    var id = req.params.id;
    var log = req.log;

    return ca.deleteInstrumentation(customer, id, function (err) {
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

    server.get({
        path: '/:account/analytics',
        name: 'DescribeAnalytics'
    }, before, describe);

    server.head({
        path: '/:account/analytics',
        name: 'HeadAnalytics'
    }, before, describe);

    server.get({
        path: '/:account/analytics/instrumentations',
        name: 'ListInstrumentations'
    }, before, list);

    server.head({
        path: '/:account/analytics/instrumentations',
        name: 'HeadInstrumentations'
    }, before, list);

    server.post({
        path: '/:account/analytics/instrumentations',
        name: 'CreateInstrumentation'
    }, before, create, resources.updateResource);

    server.get({
        path: '/:account/analytics/instrumentations/:id',
        name: 'GetInstrumentation'
    }, before, get);

    server.head({
        path: '/:account/analytics/instrumentations/:id',
        name: 'HeadInstrumentation'
    }, before, get);

    server.get({
        path: '/:account/analytics/instrumentations/:id/value/raw',
        name: 'GetInstrumentationValue'
    }, before, getValue);

    server.head({
        path: '/:account/analytics/instrumentations/:id/value/raw',
        name: 'HeadInstrumentationValue'
    }, before, getValue);

    server.get({
        path: '/:account/analytics/instrumentations/:id/value/heatmap/image',
        name: 'GetInstrumentationHeatmap'
    }, before, heatmap);

    server.head({
        path: '/:account/analytics/instrumentations/:id/value/heatmap/image',
        name: 'HeadInstrumentationHeatmap'
    }, before, heatmap);

    server.get({
        path: '/:account/analytics/instrumentations/:id/value/heatmap/details',
        name: 'GetInstrumentationHeatmapDetails'
    }, before, heatmapDetails);

    server.head({
        path: '/:account/analytics/instrumentations/:id/value/heatmap/details',
        name: 'HeadInstrumentationHeatmapDetails'
    }, before, heatmapDetails);

    server.post({
        path: '/:account/analytics/instrumentations/:id',
        name: 'CloneInstrumentation'
    }, before, clone, resources.updateResource);

    server.del({
        path: '/:account/analytics/instrumentations/:id',
        name: 'DeleteInstrumentation'
    }, before, del, resources.deleteResource);

    return server;
}



///--- Exports

module.exports = {
    mount: mount
};
