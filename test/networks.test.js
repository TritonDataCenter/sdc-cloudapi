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
var vasync = require('vasync');

///--- Globals

var client, server, NET_UUID, NIC_TAG_NAME, NIC_TAG, NETWORK1, NETWORK2, POOL;

// -- Network helpers

function createTestNicTag(cb) {
    NIC_TAG_NAME =  'nictag_test_' +  process.pid;
    client.napi.createNicTag(NIC_TAG_NAME, function (err, res) {
        if (err) {
            return cb(err);
        } else {
            NIC_TAG = res;
            return cb(null, res);
        }
    });
}


function deleteTestNicTag(cb) {
    client.napi.deleteNicTag(NIC_TAG_NAME, function (err) {
        return cb(err);
    });
}


function createTestNetwork(id, octet, cb) {
    var params = {
        name: 'network-test-' + id,
        vlan_id: 59,
        subnet: '10.99.' + octet + '.0/24',
        provision_start_ip: '10.99.' + octet + '.5',
        provision_end_ip: '10.99.' + octet + '.250',
        nic_tag: NIC_TAG_NAME
    };

    client.napi.createNetwork(params, cb);
}


function deleteTestNetwork(net, cb) {
    client.napi.deleteNetwork(net.uuid, { force: true }, cb);
}


function createTestPool(cb) {
    var params = {
        name: 'network_pool' + process.pid,
        networks: [ NETWORK1.uuid ]
    };

    client.napi.createNetworkPool(params.name, params, function (err, res) {
        if (err) {
            return cb(err);
        } else {
            POOL = res;
            return cb(null, res);
        }
    });
}

function deleteTestPool(cb) {
    client.napi.deleteNetworkPool(POOL.uuid, function (err) {
        return cb(err);
    });
}

// --- Test helper:

function checkNetwork(t, net) {
    t.ok(net, 'Network OK');
    t.ok(net.name, 'Network name OK');
    t.ok(net.id, 'Network id OK');
    t.ok(net['public'] !== undefined, 'Network public');
}

test('setup', function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
            server = _server;
        }
        client = _client;

        vasync.pipeline({ funcs: [
            function createTag(_, next) {
                createTestNicTag(next);
            },
            function createNetwork1(_, next) {
                createTestNetwork(process.pid, 90, function (err2, net1) {
                    NETWORK1 = net1;
                    next(err2);
                });
            },
            function createNetwork2(_, next) {
                createTestNetwork(process.pid + 1, 91, function (err2, net2) {
                    NETWORK2 = net2;
                    next(err2);
                });
            },
            function createPool(_, next) {
                createTestPool(next);
            }
        ] }, function (err2) {
            t.ifError(err2);
            t.end();
        });
    });
});

test('list networks', function (t) {
    var poolFound = false;
    var netFound  = false;

    client.get('/my/networks', function (err, req, res, body) {
        t.ifError(err, 'GET /my/networks error');
        t.equal(res.statusCode, 200, 'GET /my/networks status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/networks body');
        t.ok(Array.isArray(body), 'GET /my/networks body is an array');

        if (!Array.isArray(body)) {
            return t.end();
        }

        t.ok(body.length, 'GET /my/networks body array has elements');

        body.forEach(function (n) {
            t.ok(n.id !== NETWORK1.uuid, 'should not list network in pool');
            checkNetwork(t, n);
            if (n.id === POOL.uuid) {
                poolFound = true;
            }
            if (n.id === NETWORK2.uuid) {
                netFound = true;
            }
        });

        t.ok(poolFound);
        t.ok(netFound);

        // This will likely be our default setup external network
        NET_UUID = body[0].id;
        return t.end();
    });
});

test('get network', function (t) {
    client.get('/my/networks/' + NET_UUID, function (err, req, res, body) {
        t.ifError(err, 'GET /my/networks/' + NET_UUID + ' error');
        t.equal(res.statusCode, 200, 'GET /my/networks/smartos status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/networks/smartos body');
        checkNetwork(t, body);
        t.end();
    });
});

test('get network (404)', function (t) {
    client.get('/my/networks/' + uuid(), function (err) {
        t.ok(err, 'GET /my/networks/ error');
        t.equal(err.statusCode, 404, 'GET /my/networks/ status');
        t.equal(err.restCode, 'ResourceNotFound', 'GET /my/networks/ restCode');
        t.ok(err.message, 'GET /my/networks/ error message');
        t.end();
    });
});

test('teardown', function (t) {
    vasync.pipeline({ funcs: [
        function deletePool(_, next) {
            deleteTestPool(next);
        },
        function deleteNetwork1(_, next) {
            deleteTestNetwork(NETWORK1, next);
        },
        function deleteNetwork2(_, next) {
            deleteTestNetwork(NETWORK2, next);
        },
        function deleteTag(_, next) {
            deleteTestNicTag(next);
        }
    ] }, function (err) {
        t.ifError(err);

        client.teardown(function (err2) {
            t.ifError(err2, 'client teardown error');

            if (!process.env.SDC_SETUP_TESTS) {
                var cli = server._clients;
                Object.keys(cli).forEach(function (c) {
                    if (cli[c].client && cli[c].client.close) {
                        cli[c].client.close();
                    }
                });
                cli.ufds.client.removeAllListeners('close');

                server.close(function () {
                    t.end();
                });
            } else {
                t.end();
            }
        });
    });
});
