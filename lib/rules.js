// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var async = require('async');
var restify = require('restify');

var MissingParameterError = restify.MissingParameterError;

function translate(rule) {
    return ({
        id: rule.uuid,
        rule: rule.rule,
        enabled: rule.enabled
    });
}

///--- Functions

function create(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    if (!req.params.rule) {
        return next(new MissingParameterError('rule is a required argument'));
    }
    var rule = req.params.rule;
    var enabled = req.params.enabled ? req.params.enabled : false;
    var fwapi = req.sdc.fwapi;

    return fwapi.createRule({
        owner_uuid: customer,
        rule: rule,
        enabled: enabled
    }, function (err, r) {
        if (err) {
            return next(err);
        }
        log.debug('POST %s => %j', req.path(), r);
        res.setHeader('x-joyent-jobid', r.job_uuid);
        res.send(201, translate(r.rule));
        return next();

    });
}


function list(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var fwapi = req.sdc.fwapi;

    return fwapi.listRules({
        owner_uuid: customer
    }, function (err, rules) {
        if (err) {
            return next(err);
        }
        log.debug('GET %s => %j', req.path(), rules);
        res.send(rules.map(translate));
        return next();
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var id = req.params.id;
    var fwapi = req.sdc.fwapi;

    return fwapi.getRule(id, {
        owner_uuid: customer
    }, function (err, rule) {
        if (err) {
            return next(err);
        }
        log.debug('GET %s => %j', req.path(), rule);
        res.send(translate(rule));
        return next();
    });
}


function update(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var id = req.params.id;
    var fwapi = req.sdc.fwapi;

    var params = {
        owner_uuid: customer
    };
    if (!req.params.rule) {
        return next(new MissingParameterError('rule is a required argument'));
    }

    params.rule = req.params.rule;

    if (typeof (req.params.enabled) !== 'undefined') {
        params.enabled = req.params.enabled;
    }

    return fwapi.updateRule(id, params, function (err, r) {
        if (err) {
            return next(err);
        }
        log.debug('POST %s => %j', req.path(), r);
        res.setHeader('x-joyent-jobid', r.job_uuid);
        res.send(200, translate(r.rule));
        return next();
    });
}


function enable(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var id = req.params.id;
    var fwapi = req.sdc.fwapi;

    return fwapi.updateRule(id, {
        enabled: true,
        owner_uuid: customer
    }, function (err, r) {
        if (err) {
            return next(err);
        }

        log.debug('POST %s => %j', req.path(), r);
        res.setHeader('x-joyent-jobid', r.job_uuid);
        res.send(200, translate(r.rule));
        return next();
    });
}


function disable(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var id = req.params.id;
    var fwapi = req.sdc.fwapi;

    return fwapi.updateRule(id, {
        enabled: false,
        owner_uuid: customer
    }, function (err, r) {
        if (err) {
            return next(err);
        }

        log.debug('POST %s => %j', req.path(), r);
        res.setHeader('x-joyent-jobid', r.job_uuid);
        res.send(200, translate(r.rule));
        return next();
    });
}


function del(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var id = req.params.id;
    var fwapi = req.sdc.fwapi;

    return fwapi.deleteRule(id, {
        owner_uuid: customer
    }, function (err, r) {
        if (err) {
            return next(err);
        }

        res.setHeader('x-joyent-jobid', r.job_uuid);
        log.debug('DELETE %s -> ok', req.path());
        res.send(204);
        return next();
    });
}


function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.post({
        path: '/:account/fwrules',
        name: 'CreateRule'
    }, before, create);

    server.post({
        path: '/:account/fwrules/:id',
        name: 'UpdateRule'
    }, before, update);

    server.get({
        path: '/:account/fwrules',
        name: 'ListRules'
    }, before, list);

    server.head({
        path: '/:account/fwrules',
        name: 'HeadRules'
    }, before, list);

    server.get({
        path: '/:account/fwrules/:id',
        name: 'GetRule'
    }, before, get);

    server.head({
        path: '/:account/fwrules/:id',
        name: 'HeadRule'
    }, before, get);

    server.post({
        path: '/:account/fwrules/:id/enable',
        name: 'EnableRule'
    }, before, enable);

    server.post({
        path: '/:account/fwrules/:id/disable',
        name: 'DisableRule'
    }, before, disable);

    server.del({
        path: '/:account/fwrules/:id',
        name: 'DeleteRule'
    }, before, del);

    return server;
}



///--- Exports

module.exports = {
    mount: mount
};
