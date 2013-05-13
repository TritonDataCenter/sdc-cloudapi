// Copyright 2013 Joyent, Inc.  All rights reserved.

var test = require('tap').test;
var uuid = require('node-uuid');
var util = require('util');
var common = require('./common');



///--- Globals

var client, server, THE_PACKAGE;

// May or not be created by previous test run or whatever else:
var sdc_512_ownership = {
    name: 'sdc_512_ownership',
    version: '1.0.0',
    max_physical_memory: 512,
    quota: 10240,
    max_swap: 1024,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    'default': false,
    vcpus: 1,
    urn: 'sdc:' + uuid() + ':sdc_512_ownership:1.0.0',
    active: true,
    owner_uuid: uuid()
};


var sdc_512_ownership_entry;


///--- Helpers

function checkPackage_6_5(t, pkg) {
    t.ok(pkg, 'Package OK');
    t.ok(pkg.name, 'Package name');
    t.notOk(pkg.id, 'Package id not OK');
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
    t.ok(pkg.id, 'Package id OK');
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

        client.pkg.get(sdc_512_ownership.urn, function (err4, pkg) {
            if (err4) {
                if (err4.restCode === 'ResourceNotFound') {
                    client.pkg.add(sdc_512_ownership,
                        function (err5, pkg2) {
                            t.ifError(err5,
                                'Error creating package');
                            t.ok(pkg2, 'Package created OK');
                            sdc_512_ownership_entry = pkg2;
                            t.end();
                        });
                } else {
                    t.ifError(err4, 'Error fetching package');
                    t.end();
                }

            } else {
                sdc_512_ownership_entry = pkg;
                t.end();
            }
        });
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
            t.ok(p.id !== sdc_512_ownership_entry.uuid);
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
            t.ok(p.id !== sdc_512_ownership_entry.uuid);
        });
        t.end();
    });
});


test('search packages (7.0)', function (t) {
    client.get({
        path: '/my/packages?memory=128',
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
            t.equal(128, p.memory);
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


test('GetPackage by id OK (7.0)', function (t) {
    client.get({
        path: '/my/packages/' + THE_PACKAGE.id,
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
            Object.keys(server._clients).forEach(function (c) {
                if (typeof (server._clients[c].client) !== 'undefined' &&
                    typeof (server._clients[c].client.close) ===
                        'function') {
                    server._clients[c].client.close();
                    }
            });
            server._clients.ufds.client.removeAllListeners('close');
            server.close(function () {
                t.end();
            });
        } else {
            t.end();
        }
    });
});
