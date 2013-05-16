// Copyright 2013 Joyent, Inc.  All rights reserved.

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
    
    var d = path.resolve(__dirname, '..', './build/');
    server.get('/docs/public/index.html', restify.serveStatic({directory: d}));
    server.get('/docs/public/admin.html', restify.serveStatic({directory: d}));
    server.get('/docs/public/media/css/restdown.css', restify.serveStatic({
        directory: d
    }));
    server.get('/favicon.ico', restify.serveStatic({
        directory:
            path.resolve(__dirname, '..', './build/docs/public/media/img/')
    }));
    server.get('/docs/public/media/img/heatmap.png', restify.serveStatic({
        directory: d
    }));
    server.get('/docs/public/media/img/logo.png', restify.serveStatic({
        directory: d
    }));

    /* END JSSTYLED */
    return server;
}


// --- Exports

module.exports = {
    mount: mount
};
