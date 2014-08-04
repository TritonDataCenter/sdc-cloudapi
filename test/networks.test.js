// Copyright 2013 Joyent, Inc.  All rights reserved.

var test = require('tap').test;
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var util = require('util');
var common = require('./common');

var TAP_CONF = {
    timeout: 'Infinity '
};

///--- Globals

var client, server, NET_UUID, NIC_TAG_NAME, NIC_TAG, NETWORK, POOL;

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


function createTestNetwork(cb) {
    var params = {
        name: 'network-test-' + process.pid,
        vlan_id: 0,
        subnet: '10.99.99.0/24',
        provision_start_ip: '10.99.99.5',
        provision_end_ip: '10.99.99.250',
        nic_tag: NIC_TAG_NAME
    };
    client.napi.createNetwork(params, function (err, res) {
        if (err) {
            return cb(err);
        } else {
            NETWORK = res;
            return cb(null, res);
        }
    });
}


function deleteTestNetwork(cb) {
    client.napi.deleteNetwork(NETWORK.uuid, { force: true }, function (err) {
        return cb(err);
    });
}


function createTestPool(cb) {
    var params = {
        name: 'network_pool' + process.pid,
        networks: [ NETWORK.uuid ]
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

test('setup', TAP_CONF, function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
            server = _server;
        }
        client = _client;
        createTestNicTag(function (err1, _1) {
            t.ifError(err1);
            createTestNetwork(function (err2, _2) {
                t.ifError(err2);
                createTestPool(function (err3, _3) {
                    t.ifError(err3);
                    t.end();
                });
            });
        });
    });
});

test('list networks', function (t) {
    var pool_found = false;
    client.get('/my/networks', function (err, req, res, body) {
        t.ifError(err, 'GET /my/networks error');
        t.equal(res.statusCode, 200, 'GET /my/networks status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/networks body');
        t.ok(Array.isArray(body), 'GET /my/networks body is an array');
        t.ok(body.length, 'GET /my/networks body array has elements');
        body.forEach(function (n) {
            checkNetwork(t, n);
            if (n.id === POOL.uuid) {
                pool_found = true;
            }
        });
        t.ok(pool_found);
        // This will likely be our default setup external network
        NET_UUID = body[0].id;
        t.end();
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
    deleteTestPool(function (e1) {
        t.ifError(e1);
        deleteTestNetwork(function (e2) {
            t.ifError(e2);
            deleteTestNicTag(function (e3) {
                t.iferror(e3);
                client.teardown(function (err) {
                    t.ifError(err, 'client teardown error');
                    if (!process.env.SDC_SETUP_TESTS) {
                        var cli = server._clients;
                        Object.keys(cli).forEach(function (c) {
                            if (typeof (cli[c].client) !== 'undefined' &&
                                typeof (cli[c].client.close) ===
                                    'function') {
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
    });
});
