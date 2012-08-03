// Copyright 2012 Joyent, Inc.  All rights reserved.

var test = require('tap').test;
var uuid = require('node-uuid');
var util = require('util');
var common = require('./common');



///--- Globals

var client, server;



///--- Helpers

function checkPackage(t, pkg) {
    t.ok(pkg);
    t.ok(pkg.name);
    t.ok(pkg.urn);
    t.ok(pkg.memory);
    t.ok(pkg.disk);
    t.ok(pkg.vcpus);
    t.ok(pkg.swap);
    t.ok(pkg['default'] !== undefined);
}



///--- Tests

test('setup', function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);
        client = _client;
        t.ok(_server);
        server = _server;
        t.end();
    });
});


test('ListPackages OK', function (t) {
    client.get('/my/packages', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        body.forEach(function (p) {
            checkPackage(t, p);
        });
        t.end();
    });
});


test('GetPackage OK', function (t) {
    client.get('/my/packages/sdc_128', function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkPackage(t, body);
        t.end();
    });
});


test('GetPackage 404', function (t) {
    client.get('/my/packages/' + uuid(), function (err) {
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
        server.close(function () {
            t.end();
        });
    });
});
