// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');



function get(req, res, next) {
    assert.ok(req.account);

    var log = req.log;

    var account = {
        id: req.account.uuid,
        login: req.account.login,
        email: req.account.email
    };

    if (req.account.company) {
        account.companyName = req.account.company;
    }
    if (req.account.cn) {
        account.firstName = req.account.cn;
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

    account.updated = req.account._mtime;

    log.debug('getAccount(%s) => %j', req.params.account, account);
    res.send(account);
    return next();
}


function update(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds;
    var id = req.account.uuid;

    var modifiableProps = ['email', 'cn', 'sn', 'company', 'address', 'city',
        'state', 'postalCode', 'country', 'phone'];

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
        params.cn = req.params.firstName;
    }

    if (req.params.lastName) {
        params.sn = req.params.lastName;
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

            if (customer.cn) {
                account.firstName = customer.cn;
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

            account.updated = customer._mtime;
            req.account = account;
            log.debug('POST Account(%s) => %j', id, req.params);
            return next(account);
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
        name: 'PostAccount'
    }, before, update);

    return server;
}



///--- Exports

module.exports = {
    mount: mount
};
