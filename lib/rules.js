/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * CloudAPI Firewall Rules Resource.
 */

var assert = require('assert');
var util = require('util');
var restify = require('restify');

var MissingParameterError = restify.MissingParameterError;
var InvalidArgumentError = restify.InvalidArgumentError;

function translate(rule) {
    var r = {
        id: rule.uuid,
        rule: rule.rule,
        enabled: rule.enabled
    };

    if (rule.global) {
        r.global = rule.global;
    }

    if (rule.description) {
        r.description = rule.description;
    }

    return (r);
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

    var p = {
        owner_uuid: customer,
        rule: rule,
        enabled: enabled
    };

    if (req.params.description) {
        p.description = req.params.description;
    }

    return fwapi.createRule(p, function (err, r) {
        if (err) {
            return next(err);
        }
        log.debug('POST %s => %j', req.path(), r);
        res.send(201, translate(r));
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

    if (typeof (req.params.description) !== 'undefined') {
        params.description = req.params.description;
    }

    // We need to fetch the rule first both, to make sure it exists and in
    // order to allow upgrading description only if rule is not global
    return fwapi.getRule(id, {
        owner_uuid: customer
    }, function (err, rule) {
        if (err) {
            return next(err);
        }

        if (rule.global) {
            return next(new InvalidArgumentError(
                    'global rules cannot be modified'));
        }

        return fwapi.updateRule(id, params, function (er2, r) {
            if (er2) {
                return next(er2);
            }
            log.debug('POST %s => %j', req.path(), r);
            res.send(200, translate(r));
            return next();
        });
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
        res.send(200, translate(r));
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
        res.send(200, translate(r));
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

        log.debug('DELETE %s -> ok', req.path());
        res.send(204);
        return next();
    });
}


function getMachineRules(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var id = req.params.id;
    var fwapi = req.sdc.fwapi;

    return fwapi.getVMrules(id, {
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


function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.post({
        path: '/:account/fwrules',
        name: 'CreateFirewallRule'
    }, before, create);

    server.post({
        path: '/:account/fwrules/:id',
        name: 'UpdateFirewallRule'
    }, before, update);

    server.get({
        path: '/:account/fwrules',
        name: 'ListFirewallRules'
    }, before, list);

    server.head({
        path: '/:account/fwrules',
        name: 'HeadFirewallRules'
    }, before, list);

    server.get({
        path: '/:account/fwrules/:id',
        name: 'GetFirewallRule'
    }, before, get);

    server.head({
        path: '/:account/fwrules/:id',
        name: 'HeadFirewallRule'
    }, before, get);

    server.post({
        path: '/:account/fwrules/:id/enable',
        name: 'EnableFirewallRule'
    }, before, enable);

    server.post({
        path: '/:account/fwrules/:id/disable',
        name: 'DisableFirewallRule'
    }, before, disable);

    server.del({
        path: '/:account/fwrules/:id',
        name: 'DeleteFirewallRule'
    }, before, del);

    server.get({
        path: '/:account/machines/:id/fwrules',
        name: 'ListMachineFirewallRules'
    }, before, getMachineRules);

    server.head({
        path: '/:account/machines/:id/fwrules',
        name: 'HeadMachineFirewallRules'
    }, before, getMachineRules);


    return server;
}



///--- Exports

module.exports = {
    mount: mount
};
