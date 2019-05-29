/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * CloudAPI Firewall Rules Resource.
 */

var assert = require('assert-plus');
var restify = require('restify');

var resources = require('./resources');

var MissingParameterError = restify.MissingParameterError;
var InvalidArgumentError = restify.InvalidArgumentError;

function translate(rule) {
    var r = {
        id: rule.uuid,
        rule: rule.rule,
        enabled: rule.enabled,
        log: rule.log || false
    };

    if (rule.global) {
        r.global = rule.global;
    }

    if (rule.description) {
        r.description = rule.description;
    }

    return (r);
}

// --- Functions

function create(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    if (!req.params.rule) {
        return next(new MissingParameterError('rule is a required argument'));
    }
    var rule = req.params.rule;
    var enabled = req.params.enabled ? req.params.enabled : false;
    var rLog = req.params.log ? req.params.log : false;
    var fwapi = req.sdc.fwapi;

    var p = {
        owner_uuid: customer,
        rule: rule,
        enabled: enabled,
        log: rLog
    };

    if (req.params.description) {
        p.description = req.params.description;
    }

    return fwapi.createRule(p, function (err, r) {
        if (err) {
            return next(err);
        }
        if (req.headers['role-tag'] || req.activeRoles) {
            // The resource we want to save is the individual one we've
            // just created, not the collection URI:
            req.resourcename = req.resourcename + '/' + r.uuid;
            req.resource = {
                name: req.resourcename,
                account: req.account.uuid,
                roles: []
            };
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

    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }

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
        if (req.accountMgmt) {
            resources.getRoleTags(req, res);
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
    var params = req.params;

    var args = {
        owner_uuid: customer
    };

    if (params.rule !== undefined) {
        args.rule = params.rule;
    }

    if (params.enabled !== undefined) {
        args.enabled = params.enabled;
    }

    if (params.log !== undefined) {
        args.log = params.log;
    }

    if (params.description !== undefined) {
        args.description = params.description;
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

        return fwapi.updateRule(id, args, function (er2, r) {
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
    }, function (err) {
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
    var id = req.params.machine;
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
    assert.object(server);
    assert.ok(before);

    server.post({
        path: '/:account/fwrules',
        name: 'CreateFirewallRule'
    }, before, create, resources.updateResource);

    server.post({
        path: '/:account/fwrules/:id',
        name: 'UpdateFirewallRule'
    }, before, update, resources.updateResource);

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
    }, before, del, resources.deleteResource);

    server.get({
        path: '/:account/machines/:machine/fwrules',
        name: 'ListMachineFirewallRules'
    }, before, getMachineRules);

    server.head({
        path: '/:account/machines/:machine/fwrules',
        name: 'HeadMachineFirewallRules'
    }, before, getMachineRules);


    return server;
}



// --- Exports

module.exports = {
    mount: mount
};
