/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var test = require('tape').test;
var util = require('util');
var common = require('./common');


// --- Globals


// May or not be created by previous test run or whatever else:
var SDC_512 = {
    uuid: '4667d1b8-0bc7-466c-bf62-aae98ba5efa9',
    name: 'sdc_512_ownership',
    version: '1.0.0',
    max_physical_memory: 512,
    quota: 20480,
    max_swap: 1024,
    cpu_cap: 150,
    max_lwps: 2000,
    zfs_io_priority: 10,
    'default': false,
    vcpus: 2,
    active: true,
    owner_uuids: ['b99598ca-d56c-4374-8fdd-32e60f4d1592']
};

var CLIENTS;
var CLIENT;
var SERVER;


// --- Helpers


function checkPackage_6_5(t, pkg) {
    t.ok(pkg, 'Package OK');
    t.ok(pkg.name, 'Package name');
    t.notOk(pkg.id, 'Package has not id');
    t.ok(pkg.memory, 'Package memory');
    t.ok(pkg.disk, 'Package Disk');
    t.ok(!isNaN(pkg.vcpus), 'Package VCPUs OK');
    t.notOk(pkg.version, 'Package has not version');
    t.ok(pkg.swap, 'Package swap');
    t.ok(pkg['default'] !== undefined, 'Package default');
}


function checkPackage_7(t, pkg) {
    t.ok(pkg, 'Package OK');
    t.ok(pkg.name, 'Package name');
    t.ok(pkg.id, 'Package id OK');
    t.ok(pkg.memory, 'Package memory');
    t.ok(pkg.disk, 'Package Disk');
    t.ok(!isNaN(pkg.vcpus), 'Package VCPUs OK');
    t.ok(pkg.version, 'Package version OK');
    t.ok(pkg.swap, 'Package swap');
    t.ok(pkg.lwps, 'Package lwps');
    t.ok(pkg['default'] !== undefined, 'Package default');
}


function searchAndCheck(query, t, checkAttr) {
    CLIENT.get({
        path: '/my/packages?' + query,
        headers: {
            'accept-version': '~7.0'
        }
    }, function (err, req, res, body) {
        t.ifError(err);

        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.ok(Array.isArray(body));
        t.ok(body.length > 0);

        body.forEach(function (p) {
            checkPackage_7(t, p);
            checkAttr(p);
        });

        t.end();
    });
}


// --- Tests


test('setup', function (t) {
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        SERVER  = server;

        SDC_512.owner_uuids.push(CLIENT.account.uuid);

        common.addPackage(CLIENT, SDC_512, function (err) {
            if (err) {
                throw err;
            }

            t.end();
        });
    });
});


test('ListPackages OK (6.5)', function (t) {
    CLIENT.get({
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
    CLIENT.get({
        path: '/my/packages/' + SDC_512.name,
        headers: {
            'accept-version': '~6.5'
        }
    }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.deepEqual(body, {
            name:    SDC_512.name,
            memory:  SDC_512.max_physical_memory,
            disk:    SDC_512.quota,
            swap:    SDC_512.max_swap,
            vcpus:   SDC_512.vcpus,
            lwps:    SDC_512.max_lwps,
            default: SDC_512.default
        });

        t.end();
    });
});


test('ListPackages OK (7.0)', function (t) {
    CLIENT.get({
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


test('search packages by name (7.0)', function (t) {
    searchAndCheck('name=' + SDC_512.name, t, function (pkg) {
        t.equal(pkg.name, SDC_512.name);
    });
});


test('search packages by memory (7.0)', function (t) {
    searchAndCheck('memory=128', t, function (pkg) {
        t.equal(pkg.memory, 128);
    });
});


test('search packages by disk (7.0)', function (t) {
    searchAndCheck('disk=10240', t, function (pkg) {
        t.equal(pkg.disk, 10240);
    });
});


test('search packages by swap (7.0)', function (t) {
    searchAndCheck('swap=512', t, function (pkg) {
        t.equal(pkg.swap, 512);
    });
});


test('search packages by lwps (7.0)', function (t) {
    searchAndCheck('lwps=2000', t, function (pkg) {
        t.equal(pkg.lwps, 2000);
    });
});


test('search packages by vcpus (7.0)', function (t) {
    searchAndCheck('vcpus=2', t, function (pkg) {
        t.equal(pkg.vcpus, 2);
    });
});


test('search packages by version (7.0)', function (t) {
    searchAndCheck('version=1.0.0', t, function (pkg) {
        t.equal(pkg.version, '1.0.0');
    });
});


test('GetPackage by name OK (7.0)', function (t) {
    CLIENT.get({
        path: '/my/packages/' + SDC_512.name,
        headers: {
            'accept-version': '~7.0'
        }
    }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.deepEqual(body, {
            name:    SDC_512.name,
            memory:  SDC_512.max_physical_memory,
            disk:    SDC_512.quota,
            swap:    SDC_512.max_swap,
            vcpus:   SDC_512.vcpus,
            lwps:    SDC_512.max_lwps,
            default: SDC_512.default,
            id:      SDC_512.uuid,
            version: SDC_512.version
        });

        t.end();
    });
});


test('GetPackage by id OK (7.0)', function (t) {
    CLIENT.get({
        path: '/my/packages/' + SDC_512.uuid,
        headers: {
            'accept-version': '~7.0'
        }
    }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.deepEqual(body, {
            name:    SDC_512.name,
            memory:  SDC_512.max_physical_memory,
            disk:    SDC_512.quota,
            swap:    SDC_512.max_swap,
            vcpus:   SDC_512.vcpus,
            lwps:    SDC_512.max_lwps,
            default: SDC_512.default,
            id:      SDC_512.uuid,
            version: SDC_512.version
        });

        t.end();
    });
});


test('GetPackage 404', function (t) {
    CLIENT.get('/my/packages/' + common.uuid(), function (err) {
        t.ok(err);
        t.equal(err.statusCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);
        t.end();
    });
});


test('teardown', function (t) {
    common.deletePackage(CLIENT, SDC_512, function (err) {
        t.ifError(err);

        common.teardown(CLIENTS, SERVER, function () {
            t.end();
        });
    });
});
