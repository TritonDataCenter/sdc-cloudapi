/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var test = require('tape').test;
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var util = require('util');
var common = require('./common');

///--- Globals

var client, server, THE_PACKAGE;

// May or not be created by previous test run or whatever else:
var sdc_512_ownership = {
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

var sdc_128_ok = {
    uuid: 'df27bb35-8569-48fb-8dd7-ffd61a118aff',
    name: 'sdc_128_ok',
    version: '1.0.0',
    max_physical_memory: 128,
    quota: 10240,
    max_swap: 512,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    'default': false,
    vcpus: 1,
    active: true,
    owner_uuids: ['f1ea132f-e460-4061-ad62-727c2a25a5b0']
};

var sdc_512_ownership_entry, sdc_128_ok_entry;

// Add custom packages, given "sdc_" default ones will be owner by admin user.
function add128Ok(t, cb) {
    return client.papi.get(sdc_128_ok.uuid, {}, function (err, pkg) {
        if (err) {
            if (err.restCode === 'ResourceNotFound') {
                return client.papi.add(sdc_128_ok, function (err2, pkg2) {
                    t.ifError(err2, 'Error creating package');
                    t.ok(pkg2, 'Package created OK');
                    sdc_128_ok_entry = pkg2;
                    return cb();
                });
            } else {
                t.ifError(err, 'Error fetching package');
                return cb();
            }
        } else {
            sdc_128_ok_entry = pkg;
            return cb();
        }
    });
}


function add512Ownership(t, owner_uuid, cb) {
    sdc_512_ownership.owner_uuids.push(owner_uuid);

    return client.papi.get(sdc_512_ownership.uuid, {}, function (err, pkg) {
        if (err) {
            if (err.restCode === 'ResourceNotFound') {
                return client.papi.add(sdc_512_ownership,
                    function (err2, pkg2) {
                    t.ifError(err2, 'Error creating package');
                    t.ok(pkg2, 'Package created OK');
                    sdc_512_ownership_entry = pkg2;
                    return cb();
                });
            } else {
                t.ifError(err, 'Error fetching package');
                return cb();
            }
        } else {
            sdc_512_ownership_entry = pkg;
            return cb();
        }
    });
}


///--- Helpers

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
    client.get({
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


///--- Tests

test('setup', function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);

        client = _client;
        server = _server;

        add128Ok(t, function () {
            add512Ownership(t, client.account.uuid, function () {
                t.end();
            });
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
        });
        t.end();
    });
});


test('GetPackage OK (6.5)', function (t) {
    client.get({
        path: '/my/packages/sdc_512_ownership',
        headers: {
            'accept-version': '~6.5'
        }
    }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.deepEqual(body, {
            name: 'sdc_512_ownership',
            memory: 512,
            disk: 20480,
            swap: 1024,
            vcpus: 2,
            lwps: 2000,
            default: false
        });

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


test('search packages by name (7.0)', function (t) {
    searchAndCheck('name=sdc_512_ownership', t, function (pkg) {
        t.equal(pkg.name, 'sdc_512_ownership');
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
    client.get({
        path: '/my/packages/sdc_512_ownership',
        headers: {
            'accept-version': '~7.0'
        }
    }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.deepEqual(body, {
            name: 'sdc_512_ownership',
            memory: 512,
            disk: 20480,
            swap: 1024,
            vcpus: 2,
            lwps: 2000,
            default: false,
            id: '4667d1b8-0bc7-466c-bf62-aae98ba5efa9',
            version: '1.0.0'
        });

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
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.deepEqual(body, {
            name: 'sdc_512_ownership',
            memory: 512,
            disk: 20480,
            swap: 1024,
            vcpus: 2,
            lwps: 2000,
            default: false,
            id: '4667d1b8-0bc7-466c-bf62-aae98ba5efa9',
            version: '1.0.0'
        });

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
    client.papi.del(sdc_512_ownership.uuid, { force: true }, function (err) {
        t.ifError(err);

        client.papi.del(sdc_128_ok.uuid, { force: true }, function (err2) {
            t.ifError(err2);

            client.teardown(function (err3) {
                t.ifError(err3, 'client teardown error');

                if (!server) {
                    return t.end();
                }

                Object.keys(server._clients).forEach(function (c) {
                    var sdcClient = server._clients[c].client;

                    if (sdcClient !== undefined &&
                        typeof (sdcClient.close) === 'function') {
                        sdcClient.close();
                    }
                });

                server._clients.ufds.client.removeAllListeners('close');

                server.close(function () {
                    t.end();
                });

                return null; // keep jslint happy
            });
        });
    });
});
