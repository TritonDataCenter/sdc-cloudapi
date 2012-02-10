// Copyright 2012 Joyent, Inc.  All rights reserved.

var path = require('path');

var filed = require('filed');
var mime = require('mime');
var restify = require('restify');



///--- Globals

var NotAuthorizedError = restify.NotAuthorizedError;



///--- Functions

function serve(req, res, next) {
    var fname = path.normalize('./build' + req.path);
    var log = req.log;

    log.debug('GET %s maps to %s', req.path, fname);

    /* JSSTYLED */
    if (!/^build\/docs\/public\/?.*/.test(fname))
        return next(new NotAuthorizedError());

    res.contentType = mime.lookup(fname);
    var f = filed(fname);
    f.pipe(res);
    f.on('end', function () {
        return next(false);
    });

    return false;
}


function redirect(req, res, next) {
    res.header('Location', '/docs/public/index.html');
    res.send(302);
    return next(false);
}


function mount(server) {
    server.get('/', redirect);
    server.get('/docs', redirect);
    server.get('/docs/public', redirect);
    server.get(/\/docs\/public\/\S+/, serve);

    return server;
}



///--- Exports

module.exports = {
    mount: mount
};
