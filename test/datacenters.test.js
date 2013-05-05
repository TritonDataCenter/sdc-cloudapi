// Copyright 2012 Joyent, Inc.  All rights reserved.

var test = require('tap').test;
var uuid = require('node-uuid');

var common = require('./common');



// --- Globals

var client, server, cfg = common.getCfg();

var DC_NAME = Object.keys(cfg.datacenters)[0];
// --- Tests

test('setup', function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);
        client = _client;
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
        }
        server = _server;
        t.end();
    });
});


test('ListDatacenters OK', function (t) {
    client.get('/my/datacenters', function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 200);
        t.ok(body[process.env.DATACENTER || DC_NAME]);
        t.end();
    });
});


test('GetDatacenter OK', function (t) {
    var dc = process.env.DATACENTER || DC_NAME;
    client.get('/my/datacenters/' + dc, function (err, req, res, body) {
        t.ifError(err);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 302);
        t.equal(body.code, 'ResourceMoved');
        t.ok(body.message);
        t.end();
    });
});


test('GetDatacenter 404', function (t) {
    client.get('/my/datacenters/' + uuid(), function (err) {
        t.ok(err);
        t.equal(err.statusCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);
        t.end();
    });
});


test('teardown', function (t) {
    client.teardown(function (err) {
        t.ifError(err, 'client teardown error');
        if (!process.env.SDC_SETUP_TESTS) {
            server._clients.ufds.client.removeAllListeners('close');
            server.close(function () {
                t.end();
            });
        } else {
            t.end();
        }
    });
});
