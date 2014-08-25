/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var path = require('path');
var restify = require('restify');


// --- Functions

function redirect(req, res, next) {
    res.set('Content-Length', 0);
    res.set('Connection', 'keep-alive');
    res.set('Date', new Date());
    res.header('Location', 'http://apidocs.joyent.com/cloudapi/');
    res.set('Server', 'Cloud API');
    res.send(302);
    return next(false);
}


function favicon(req, res, next) {
    res.set('Content-Length', 0);
    res.set('Connection', 'keep-alive');
    res.set('Date', new Date());
    res.header('Location', 'http://apidocs.joyent.com/favicon.ico');
    res.set('Server', 'Cloud API');
    res.send(302);
    return next(false);
}

function mount(server) {
    server.get('/', redirect);
    server.get(/^\/docs\/?/, redirect);
    server.get('/favicon.ico', favicon);
    /* END JSSTYLED */
    return server;
}


// --- Exports

module.exports = {
    mount: mount
};
