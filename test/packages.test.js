// Copyright 2012 Joyent, Inc.  All rights reserved.

var test = require('tap').test;
var uuid = require('node-uuid');
var util = require('util');
var common = require('./common');



///--- Globals

var client, server, THE_PACKAGE;



///--- Helpers

function checkPackage_6_5(t, pkg) {
    t.ok(pkg, 'Package OK');
    t.ok(pkg.name, 'Package name');
    t.notOk(pkg.urn, 'Package URN not OK');
    t.notOk(pkg.uuid, 'Package UUID not OK');
    t.ok(pkg.memory, 'Package memory');
    t.ok(pkg.disk, 'Package Disk');
    t.notOk(pkg.vcpus, 'Package VCPUs not OK');
    t.notOk(pkg.version, 'Package version not OK');
    t.ok(pkg.swap, 'Package swap');
    t.ok(pkg['default'] !== undefined, 'Package default');
}


function checkPackage_7(t, pkg) {
    t.ok(pkg, 'Package OK');
    t.ok(pkg.name, 'Package name');
    t.ok(pkg.urn, 'Package URN OK');
    t.ok(pkg.uuid, 'Package UUID OK');
    t.ok(pkg.memory, 'Package memory');
    t.ok(pkg.disk, 'Package Disk');
    t.ok(pkg.vcpus, 'Package VCPUs OK');
    t.ok(pkg.version, 'Package version OK');
    t.ok(pkg.swap, 'Package swap');
    t.ok(pkg['default'] !== undefined, 'Package default');
}


///--- Tests

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


test('ListPackages OK (6.5)', function (t) {
    client.get({
        path: '/my/packages',
        headers: {
            'accept-version': '~6.5'
        }
    }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        body.forEach(function (p) {
            checkPackage_6_5(t, p);
        });
        t.end();
    });
});


test('GetPackage OK (6.5)', function (t) {
    client.get({
        path: '/my/packages/sdc_128',
        headers: {
            'accept-version': '~6.5'
        }
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkPackage_6_5(t, body);
        t.end();
    });
});


test('ListPackages OK (7.0)', function (t) {
    client.get({
        path: '/my/packages',
        headers: {
            'accept-version': '~7.0'
        }
    }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        body.forEach(function (p) {
            checkPackage_7(t, p);
        });
        t.end();
    });
});


test('GetPackage by name OK (7.0)', function (t) {
    client.get({
        path: '/my/packages/sdc_128',
        headers: {
            'accept-version': '~7.0'
        }
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkPackage_7(t, body);
        THE_PACKAGE = body;
        t.end();
    });
});


test('GetPackage by UUID OK (7.0)', function (t) {
    client.get({
        path: '/my/packages/' + THE_PACKAGE.uuid,
        headers: {
            'accept-version': '~7.0'
        }
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkPackage_7(t, body);
        t.end();
    });
});


test('GetPackage by URN OK (7.0)', function (t) {
    client.get({
        path: '/my/packages/' + THE_PACKAGE.urn.replace(/:/g, "%3A"),
        headers: {
            'accept-version': '~7.0'
        }
    }, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        checkPackage_7(t, body);
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
        if (!process.env.SDC_SETUP_TESTS) {
            server.close(function () {
                t.end();
            });
        } else {
            t.end();
        }
    });
});
