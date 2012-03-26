// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');



function get(req, res, next) {
    assert.ok(req.account);

    var log = req.log;

    var account = {
        id: req.account.uuid,
        login: req.account.login,
        email: req.account.email
    };

    if (req.account.company)
        account.companyName = req.account.company;
    if (req.account.cn)
        account.firstName = req.account.cn;
    if (req.account.sn)
        account.lastName = req.account.sn;

    account.updated = req.account._mtime;

    log.debug('getAccount(%s) => %j', req.params.account, account);
    res.send(account);
    return next();
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

    return server;
}



///--- Exports

module.exports = {
    mount: mount
};
