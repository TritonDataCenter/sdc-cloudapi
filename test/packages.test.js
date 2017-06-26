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

var checkNotFound = common.checkNotFound;


// --- Globals


// May or not be created by previous test run or whatever else:
var SDC_512 = {
    uuid: '4667d1b8-0bc7-466c-bf62-aae98ba5efa9',
    name: 'sdc_512_no_ownership',
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

// this differs from SDC_512 because the CLIENT's uuid is never added to
// owner_uuids in setup
var SDC_512_NO_PERMISSION = {
    uuid: '495971fd-3488-46da-b10f-61a088f03e39',
    name: 'sdc_512_no_permission',
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

var VIEWABLE_PACKAGE_NAMES;
var VIEWABLE_PACKAGE_UUIDS;


// --- Helpers


function checkPackage(t, pkg) {
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

    t.notEqual(VIEWABLE_PACKAGE_UUIDS.indexOf(pkg.id), -1, 'can view pkg');
}


function searchAndCheck(query, t, checkAttr) {
    CLIENT.get('/my/packages?' + query, function (err, req, res, body) {
        t.ifError(err);

        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.ok(Array.isArray(body));
        t.ok(body.length > 0);

        body.forEach(function (p) {
            checkPackage(t, p);
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
            common.addPackage(CLIENT, SDC_512_NO_PERMISSION, function (err2) {
                CLIENT.papi.list({}, {}, function (err3, pkgs) {
                    if (err || err2 || err3) {
                        throw err || err2 || err3;
                    }

                    var accUuid = CLIENT.account.uuid;
                    var viewablePkgs = pkgs.filter(function (pkg) {
                        var owners = pkg.owner_uuids;
                        return !owners || owners.indexOf(accUuid) !== -1;
                    });

                    VIEWABLE_PACKAGE_UUIDS = viewablePkgs.map(function (pkg) {
                        return pkg.uuid;
                    });

                    VIEWABLE_PACKAGE_NAMES = viewablePkgs.map(function (pkg) {
                        return pkg.name;
                    });

                    t.end();
                });
            });
        });
    });
});


test('ListPackages OK', function (t) {
    CLIENT.get('/my/packages', function (err, req, res, body) {
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


test('search packages by name', function (t) {
    searchAndCheck('name=' + SDC_512.name, t, function (pkg) {
        t.equal(pkg.name, SDC_512.name);
    });
});


test('search packages by name with wildcard', function (t) {
    var name = SDC_512.name.slice(0, -4) + '*';
    searchAndCheck('name=' + name, t, function (pkg) {
        t.equal(pkg.name, SDC_512.name);
    });
});


test('search packages by memory', function (t) {
    searchAndCheck('memory=128', t, function (pkg) {
        t.equal(pkg.memory, 128);
    });
});


test('search packages by disk', function (t) {
    searchAndCheck('disk=10240', t, function (pkg) {
        t.equal(pkg.disk, 10240);
    });
});


test('search packages by swap', function (t) {
    searchAndCheck('swap=256', t, function (pkg) {
        t.equal(pkg.swap, 256);
    });
});


test('search packages by lwps', function (t) {
    searchAndCheck('lwps=2000', t, function (pkg) {
        t.equal(pkg.lwps, 2000);
    });
});


test('search packages by vcpus', function (t) {
    searchAndCheck('vcpus=2', t, function (pkg) {
        t.equal(pkg.vcpus, 2);
    });
});


test('search packages by version', function (t) {
    searchAndCheck('version=1.0.0', t, function (pkg) {
        t.equal(pkg.version, '1.0.0');
    });
});


test('GetPackage by name OK', function (t) {
    CLIENT.get('/my/packages/' + SDC_512.name, function (err, req, res, body) {
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


test('GetPackage by name failure - no permission', function (t) {
    var path = '/my/packages/' + SDC_512_NO_PERMISSION.name;
    CLIENT.get(path, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('GetPackage by id OK', function (t) {
    CLIENT.get('/my/packages/' + SDC_512.uuid, function (err, req, res, body) {
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


test('GetPackage by id failure - no permission', function (t) {
    var path = '/my/packages/' + SDC_512_NO_PERMISSION.uuid;
    CLIENT.get(path, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
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

        common.deletePackage(CLIENT, SDC_512_NO_PERMISSION, function (err2) {
            t.ifError(err2);

            common.teardown(CLIENTS, SERVER, function (err3) {
                t.ifError(err3, 'teardown success');
                t.end();
            });
        });
    });
});
