/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var semver = require('semver');
var test = require('@smaller/tap').test;
var vasync = require('vasync');

var common = require('./common');

var checkNotFound = common.checkNotFound;


// --- Globals


// May or not be created by previous test run or whatever else:
var SDC_512 = {
    active: true,
    cpu_cap: 150,
    'default': false,
    max_lwps: 2000,
    max_physical_memory: 512,
    max_swap: 1024,
    name: 'sdc_512_no_ownership',
    owner_uuids: ['b99598ca-d56c-4374-8fdd-32e60f4d1592'],
    quota: 20480,
    uuid: '4667d1b8-0bc7-466c-bf62-aae98ba5efa9',
    vcpus: 2,
    version: '1.0.0',
    zfs_io_priority: 10
};

// this differs from SDC_512 because the CLIENT's uuid is never added to
// owner_uuids in setup
var SDC_512_NO_PERMISSION = {
    active: true,
    cpu_cap: 150,
    'default': false,
    max_lwps: 2000,
    max_physical_memory: 512,
    max_swap: 1024,
    name: 'sdc_512_no_permission',
    owner_uuids: ['b99598ca-d56c-4374-8fdd-32e60f4d1592'],
    quota: 20480,
    uuid: '495971fd-3488-46da-b10f-61a088f03e39',
    vcpus: 2,
    version: '1.0.0',
    zfs_io_priority: 10
};

var SDC_512_BHYVE_BRAND = {
    active: true,
    brand: 'bhyve',
    cpu_cap: 150,
    'default': false,
    max_lwps: 2000,
    max_physical_memory: 512,
    max_swap: 1024,
    name: 'sdc_512_bhyve',
    owner_uuids: ['b99598ca-d56c-4374-8fdd-32e60f4d1592'],
    quota: 20480,
    uuid: '93b2d408-1fb5-11e8-89ae-7fcbf72c69f8',
    vcpus: 2,
    version: '1.0.0',
    zfs_io_priority: 10
};

var SDC_512_BHYVE_FLEX = Object.assign({}, SDC_512_BHYVE_BRAND, {
    disks: [
        {},
        {size: 512},
        {size: 'remaining'}
    ],
    flexible_disk: true,
    name: 'sdc_128_bhyve_flex_disks',
    uuid: 'eaec9227-ad21-4cbe-a0ab-15cfa9b360f1'
});

var CLIENTS;
var CLIENT;
var SERVER;

var CREATED_SDC_512_BHYVE_BRAND = false;
var CREATED_SDC_512_BHYVE_FLEX = false;
var PAPI_VERSION;
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
    common.setup(function (_err, clients, server) {
        var viewablePkgs = [];

        CLIENTS = clients;
        CLIENT = clients.user;
        SERVER = server;

        SDC_512.owner_uuids.push(CLIENT.account.uuid);
        SDC_512_BHYVE_BRAND.owner_uuids.push(CLIENT.account.uuid);

        function createPackage(pkg, cb) {
            common.addPackage(CLIENT, pkg, function _onAdd(err) {
                t.ifError(err, 'create package ' + pkg.uuid +
                    ' (' + pkg.name + ')');
                cb(err);
            });
        }

        vasync.pipeline({
            funcs: [
                function _checkPapiVersion(_, cb) {
                    CLIENT.papi.client.get('/ping',
                        function _onPing(err, req, res) {
                        if (err) {
                            cb(err);
                            return;
                        }

                        PAPI_VERSION = res.headers['api-version'];
                        t.equal(typeof (PAPI_VERSION), 'string',
                            'should have api-version header');
                        if (typeof (PAPI_VERSION) !== 'string') {
                            // default to first ever version if we can't detect
                            PAPI_VERSION = '7.0.0';
                        }

                        t.ok(PAPI_VERSION, 'PAPI version is ' + PAPI_VERSION);

                        cb();
                    });
                },
                function _add512(_, cb) {
                    createPackage(SDC_512, cb);
                },
                function _add512NoPermission(_, cb) {
                    createPackage(SDC_512_NO_PERMISSION, cb);
                },
                function _add512Bhyve(_, cb) {
                    // 7.1.0 added support for pkg.brand
                    if (semver.lt(PAPI_VERSION, '7.1.0')) {
                        t.ok(true, 'skipping "brand" test on ancient PAPI');
                        cb();
                        return;
                    }

                    CREATED_SDC_512_BHYVE_BRAND = true;
                    createPackage(SDC_512_BHYVE_BRAND, cb);
                },
                function _add512BhyveFlex(_, cb) {
                    // 7.2.0 added support for pkg.flexible_disk and pkg.disks
                    if (semver.lt(PAPI_VERSION, '7.2.0')) {
                        t.ok(true, 'skipping "flexible_disk" test');
                        cb();
                        return;
                    }

                    CREATED_SDC_512_BHYVE_FLEX = true;
                    createPackage(SDC_512_BHYVE_FLEX, cb);
                },
                function _listPackages(_, cb) {
                    var accUuid;

                    CLIENT.papi.list({}, {}, function _onList(err, pkgs) {
                        if (err) {
                            cb(err);
                            return;
                        }

                        accUuid = CLIENT.account.uuid;
                        viewablePkgs = pkgs.filter(function (pkg) {
                            var owners = pkg.owner_uuids;
                            return !owners || owners.indexOf(accUuid) !== -1;
                        });

                        cb();
                    });
                }
            ]
        },
        function _addedPackages(err) {
            if (err) {
                throw err;
            }

            VIEWABLE_PACKAGE_UUIDS = viewablePkgs.map(function (pkg) {
                return pkg.uuid;
            });

            t.end();
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


test('search packages by brand', function _searchBrand(t) {
    if (!CREATED_SDC_512_BHYVE_BRAND) {
        t.ok(true, 'skipping brand tests against ancient PAPI');
        t.end();
        return;
    }
    CLIENT.get('/my/packages?brand=' + SDC_512_BHYVE_BRAND.brand,
        function _onGet(err, req, res, body) {
            var foundCreated = false;
            t.ifError(err);

            t.equal(res.statusCode, 200, 'HTTP code should be 200');
            common.checkHeaders(t, res.headers);

            t.ok(Array.isArray(body), 'body should be an array of packages');
            t.ok(body.length > 0, 'should have at least 1 package');

            // All results to our search should have brand=bhyve. We might have
            // found some other packages that we didn't create, but as long as
            // they have brand=bhyve, that's fine. We also want to make sure we
            // also found the one we created.

            body.forEach(function (p) {
                if (p.id === SDC_512_BHYVE_BRAND.uuid) {
                    foundCreated = true;
                }
                t.equal(p.brand, SDC_512_BHYVE_BRAND.brand, 'package ' +
                    p.name + ' has brand=' + SDC_512_BHYVE_BRAND.brand);
            });

            t.equal(foundCreated, true, 'should have found the package we ' +
                'created (' + SDC_512_BHYVE_BRAND.name + ') with brand=' +
                SDC_512_BHYVE_BRAND.brand);

            t.end();
        });
});


test('search packages by flexible_disk', function (t) {
    searchAndCheck('flexible_disk=true', t, function (pkg) {
        t.equal(pkg.flexible_disk, true);
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
            name: SDC_512.name,
            memory: SDC_512.max_physical_memory,
            disk: SDC_512.quota,
            swap: SDC_512.max_swap,
            vcpus: SDC_512.vcpus,
            lwps: SDC_512.max_lwps,
            default: SDC_512.default,
            id: SDC_512.uuid,
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
            name: SDC_512.name,
            memory: SDC_512.max_physical_memory,
            disk: SDC_512.quota,
            swap: SDC_512.max_swap,
            vcpus: SDC_512.vcpus,
            lwps: SDC_512.max_lwps,
            default: SDC_512.default,
            id: SDC_512.uuid,
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


test('teardown', function _teardown(t) {
    function deletePackage(pkg, cb) {
        common.deletePackage(CLIENT, pkg, function _onDel(err) {
            t.ifError(err, 'delete package ' + pkg.uuid +
                ' (' + pkg.name + ')');
            cb(err);
        });
    }

    vasync.pipeline({
        funcs: [
            function _delete512(_, cb) {
                deletePackage(SDC_512, cb);
            }, function _delete512NoPermission(_, cb) {
                deletePackage(SDC_512_NO_PERMISSION, cb);
            }, function _delete512Bhyve(_, cb) {
                if (!CREATED_SDC_512_BHYVE_BRAND) {
                    cb();
                    return;
                }
                deletePackage(SDC_512_BHYVE_BRAND, cb);
            }, function _delete512BhyveFlex(_, cb) {
                if (!CREATED_SDC_512_BHYVE_FLEX) {
                    cb();
                    return;
                }
                deletePackage(SDC_512_BHYVE_FLEX, cb);
            }
        ]
    }, function _onDeleted(err) {
        t.ifError(err, 'teardown');
        common.teardown(CLIENTS, SERVER, function _onTeardown(teardownErr) {
            t.ifError(teardownErr, 'common.teardown');
            t.end();
        });
    });
});
