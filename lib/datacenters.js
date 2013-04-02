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

function listforeign(req, res, next) {
  assert.ok(req.config);
  var ufds = req.sdc.ufds;
  if (!req.authorization.signature || !req.header('X-Auth-Token')) {
    res.send(403, {"code": "Forbidden",
      "message": "ListForeign requires HTTP signature auth token delegated authorization"});
    next();
  }
  var dev = req.authorization.signature.keyId.split('/')[1];
  req.sdc.ufds.listForeigndc(req.caller, dev, function(err, dclist) {
    if (err)
      res.send(500, {code: "InternalServerError", message: err.message});
    else
      res.send(200, dclist);
    next();
  });
}

function addforeign(req, res, next) {
  assert.ok(req.config);
  var ufds = req.sdc.ufds;
  
  if (!req.authorization.signature || !req.header('X-Auth-Token')) {
    res.send(403, {"code": "Forbidden",
      "message": "AddForeign requires HTTP signature auth token delegated authorization"});
    next();
  }
  var dev = req.authorization.signature.keyId.split('/')[1];
  dc = req.params;
  req.sdc.ufds.addForeigndc(req.caller, dev, dc, function(err, dclist) {
    if (err)
      res.send(500, {code: "InternalServerError", message: err.message});
    else
      res.send(200, dclist);
    next();
  });
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

    server.get({
        path: '/:account/foreigndatacenters',
        name: 'ListForeignDatacenters'
    }, before, listforeign);

    server.post({
        path: '/:account/foreigndatacenters',
        name: 'AddForeignDatacenter'
    }, before, addforeign);

    return server;
}



// --- API

module.exports = {
    mount: mount
};
