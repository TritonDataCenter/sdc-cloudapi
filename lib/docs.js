// Copyright 2012 Joyent, Inc.  All rights reserved.

var path = require('path');
var restify = require('restify');


// --- Functions

function redirect(req, res, next) {
    res.set('Content-Length', 0);
    res.set('Connection', 'keep-alive');
    res.set('Date', new Date());
    res.header('Location', '/docs/public/index.html');
    res.set('Server', 'Cloud API');
    res.send(302);
    return next(false);
}


function mount(server) {
    server.get('/', redirect);
    server.get('/docs', redirect);
    server.get('/docs/public', redirect);
    /* BEGIN JSSTYLED */
    server.get(/\/docs\/public\/?.*/, restify.serveStatic({
        directory: './build'
    }));
    /* END JSSTYLED */
    return server;
}


// --- Exports

module.exports = {
    mount: mount
};
