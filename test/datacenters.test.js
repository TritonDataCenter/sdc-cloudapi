// Copyright 2011 Joyent, Inc.  All rights reserved.

var test = require('tap').test;
var uuid = require('node-uuid');

var common = require('./common');



///--- Globals

var client;



///--- Tests

test('setup', function(t) {
    common.setup(function(err, _client) {
        t.ifError(err);
        t.ok(_client);
        client = _client;
        t.end();
    });
});


test('ListDatacenters OK', function(t) {
    client.get('/my/datacenters', function(err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 200);
        t.ok(body[process.env.DATACENTER || 'coal']);
        t.end();
    });
});


test('GetDatacenter OK', function(t) {
    var dc = process.env.DATACENTER || 'coal';
    client.get('/my/datacenters/' + dc, function(err, req, res, body) {
        t.ifError(err);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 302);
        t.equal(body.code, 'ResourceMoved');
        t.ok(body.message);
        t.end();
    });
});


test('GetDatacenter 404', function(t) {
    client.get('/my/datacenters/' + uuid(), function(err) {
        t.ok(err);
        t.equal(err.httpCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);
        t.end();
    });
});


test('teardown', function(t) {
    client.teardown(function(err) {
        t.ifError(err);
        t.end();
    });
});
