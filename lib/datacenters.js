// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var restify = require('restify');



// --- Globals

var MSG_302 = '';
var MSG_404 = '%s is not an available datacenter';
var ResourceNotFoundError = restify.ResourceNotFoundError;
var sprintf = util.format;



// --- Functions

function list(req, res, next) {
    assert.ok(req.config);

    var log = req.log,
        datacenters = req.config.datacenters || {};

    log.debug('listDatacenters(%s) => %j', req.params.account, datacenters);
    res.send(datacenters);

    return next();
}


function get(req, res, next) {
    assert.ok(req.config);

    var datacenters = req.config.datacenters || {},
        dc = req.params.dc,
        log = req.log,
        body;

    if (!datacenters[dc]) {
        return next(new ResourceNotFoundError(MSG_404, dc));
    }

    body = {
        code: 'ResourceMoved',
        message: sprintf(MSG_302, dc, datacenters[dc])
    };

    res.header('Location', datacenters[dc]);

    log.debug('getDatacenter(%s) => %j', dc, body);
    res.send(302, body);
    return next();
}


function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.get({
        path: '/:account/datacenters',
        name: 'ListDatacenters'
    }, before, list);

    server.get({
        path: '/:account/datacenters/:dc',
        name: 'GetDatacenter'
    }, before, get);

    return server;
}



// --- API

module.exports = {
    mount: mount
};
