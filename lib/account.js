/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * This is Top Level CloudAPI route for a given account
 */

var path = require('path');

var assert = require('assert-plus');
var restify = require('restify');

var resources = require('./resources');

var InvalidArgumentError = restify.InvalidArgumentError;

function get(req, res, next) {
    assert.ok(req.config, 'req.config');

    if (req.params.account === '--ping') {
        var data = {
            ping: 'pong',
            cloudapi: {
                versions: req.config.version
            }
        };

        // TODO
        // var v = req.getVersion();
        // if (semver.satisfies('8.0.0', v) || semver.ltr('8.0.0', v)) {
        //    data.eight = true;
        // }

        // Include a header to show the current datacenter name.
        res.header('Triton-Datacenter-Name', req.config.datacenter_name);

        res.send(data);
        return next();
    }

    assert.ok(req.account);

    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }

    var log = req.log;

    var account = {
        id: req.account.uuid,
        login: req.account.login,
        email: req.account.email
    };

    if (req.account.company) {
        account.companyName = req.account.company;
    }

    if (req.account.givenname) {
        account.firstName = req.account.givenname;
    }
    if (req.account.sn) {
        account.lastName = req.account.sn;
    }
    if (req.account.postalcode) {
        account.postalCode = req.account.postalcode;
    }

    account.triton_cns_enabled = false;
    if (req.account.triton_cns_enabled === 'true') {
        account.triton_cns_enabled = true;
    }

    ['address', 'city', 'state',
        'postalCode', 'country', 'phone'].forEach(function (p) {
            if (req.account[p]) {
                account[p] = req.account[p];
            }
        });

    account.updated = req.account.updated_at || req.account._mtime ||
        1356994800000;
    account.updated = new Date(parseInt(account.updated, 0)).toISOString();
    // If created_at has no value, set by default to
    // "Tue Jan 01 2013 00:00:00 GMT+0100 (CET)" as "the beginning day"
    account.created = req.account.created_at || 1356994800000;
    account.created = new Date(parseInt(account.created, 0)).toISOString();
    log.debug('getAccount(%s) => %j', req.params.account, account);
    res.send(account);
    return next();
}


function update(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    var modifiableProps = ['email', 'cn', 'sn', 'company', 'address', 'city',
        'state', 'postalCode', 'country', 'phone', 'givenName'];

    var params = {};
    modifiableProps.forEach(function (p) {
        if (req.params[p]) {
            params[p] = req.params[p];
        }
    });
    // We change these, check them too:
    if (req.params.companyName) {
        params.company = req.params.companyName;
    }

    if (req.params.firstName) {
        params.givenName = req.params.firstName;
    }

    if (req.params.lastName) {
        params.sn = req.params.lastName;
    }

    if (req.params.firstName && req.params.lastName) {
        params.cn = req.params.firstName + ' ' + req.params.lastName;
    }

    if (req.params.triton_cns_enabled !== undefined) {
        /* This can come in either as a string or as a boolean... sigh. */
        var cnsEnabled = req.params.triton_cns_enabled;
        if (typeof (cnsEnabled) !== 'string') {
            cnsEnabled = String(cnsEnabled);
        }

        if (cnsEnabled !== 'true' && cnsEnabled !== 'false') {
            next(new InvalidArgumentError('triton_cns_enabled must be either' +
                ' "true" or "false"'));
            return;
        }
        params.triton_cns_enabled = cnsEnabled;
    }

    ufds.updateUser(id, params, function (err) {
        if (err) {
            return next(err);
        }

        return ufds.getUser(id, function (er1, customer) {
            if (err) {
                return next(er1);
            }

            var account = {
                id: customer.uuid,
                login: customer.login,
                email: customer.email
            };

            if (customer.company) {
                account.companyName = customer.company;
            }

            if (customer.givenname) {
                account.firstName = customer.givenname;
            }

            if (customer.sn) {
                account.lastName = customer.sn;
            }

            if (customer.postalcode) {
                account.postalCode = customer.postalcode;
            }

            account.triton_cns_enabled = false;
            if (customer.triton_cns_enabled === 'true') {
                account.triton_cns_enabled = true;
            }

            ['address', 'city', 'state',
                'postalCode', 'country', 'phone'].forEach(function (p) {
                if (customer[p]) {
                    account[p] = customer[p];
                }
            });

            account.updated = customer.updated_at || customer._mtime ||
                1356994800000;
            account.updated = new Date(parseInt(account.updated, 0))
                .toISOString();
            // If created_at has no value, set by default to
            // "Tue Jan 01 2013 00:00:00 GMT+0100 (CET)" as "the beginning day"
            account.created = customer.created_at || 1356994800000;
            account.created = new Date(parseInt(account.created, 0))
                .toISOString();
            req.account = account;
            log.debug('POST Account(%s) => %j', id, req.params);
            res.send(account);
            return next();
        });
    });
}


function getProvisioningLimits(req, res, next) {
    assert.object(req.account, 'req.account');
    assert.object(req.config, 'req.config');
    assert.arrayOfObject(req.config.plugins, 'req.config.plugins');
    assert.object(req.log, 'req.log');
    assert.object(req.plugins, 'req.plugins');

    var log = req.log;

    // Find the 'provision_limits' plugin configuration.
    var limitsPlugin = req.config.plugins.find(function _pFilter(pConfig) {
        return pConfig.name === 'provision_limits';
    });

    // Ensure the plugin exists and is enabled.
    if (!limitsPlugin || !limitsPlugin.enabled || !limitsPlugin.config) {
        log.debug('getAccountLimits(%s) => [] - limits not enabled',
            req.params.account);
        res.send([]);
        next();
        return;
    }

    var pPath = path.resolve(__dirname, '../plugins/provision_limits');
    var provisionPlugin = require(pPath);

    provisionPlugin._getProvisionLimits({
        account: req.account,
        api: req.plugins.api,
        config: limitsPlugin.config,
        req_id: req.getId()
    }, function _onGetLimitUsage(_err, limits) {
        log.debug('getAccountLimits(%s) => %j', req.params.account, limits);
        res.send(limits);
        next();
    });
}


function mount(server, before) {
    assert.object(server);
    assert.ok(before);

    server.get({
        path: '/:account',
        name: 'GetAccount'
    }, before, get);

    server.head({
        path: '/:account',
        name: 'HeadAccount'
    }, before, get);

    server.post({
        path: '/:account',
        name: 'UpdateAccount'
    }, before, update, resources.updateResource);

    server.get({
        path: '/:account/limits',
        name: 'GetProvisioningLimits'
    }, before, getProvisioningLimits);

    return server;
}



// --- Exports

module.exports = {
    mount: mount
};
