/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * This is Top Level CloudAPI route for a given account
 */

var assert = require('assert');
var resources = require('./resources');


function get(req, res, next) {
    if (req.params.account === '--ping') {
        var data = {
            ping: 'pong',
            cloudapi: {
                versions: req.config.version
            }
        };
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


function mount(server, before) {
    assert.argument(server, 'object', server);
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

    return server;
}



///--- Exports

module.exports = {
    mount: mount
};
