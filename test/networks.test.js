/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

var assert = require('assert-plus');
var format = require('util').format;
var test = require('tape').test;
var vasync = require('vasync');

var common = require('./common');


// --- Globals

var CLIENTS;
var CLIENT;
var SERVER;
var OTHER;

// Fixture names
var NIC_TAG = 'sdccloudapitest_networks_nictag';
var NETWORK1_NAME = 'sdccloudapitest_networks_network1';
var NETWORK2_NAME = 'sdccloudapitest_networks_network2';
var NETWORK3_NAME = 'sdccloudapitest_networks_network3';
var POOL1_NAME = 'sdccloudapitest_networks_pool1';

// Test variables
var NO_SUCH_NETWORK_UUID = 'deaddead-c626-11e5-b674-334e7e514480';
var RESERVED_IP = '10.99.92.25';
var ZONE_IP1 = '10.99.90.52';
var ZONE_IP2 = '10.99.90.53';
var ZONE_UUID1 = 'c4311f24-de18-40b9-b57e-249f2aec7533';
var ZONE_UUID2 = '5dd79db9-3d42-40a3-a600-7fa2984ff48c';


// --- Helpers

// Delete all test data (fixtures) for this test file.
function deleteFixtures(t, cb) {
    vasync.pipeline({funcs: [
        function deletePool1(_, next) {
            common.napiDeletePoolByName({
                napi: CLIENT.napi,
                name: POOL1_NAME
            }, function (err) {
                t.ifError(err, 'deletePool1');
                next();
            });
        },
        function deleteNetwork1(_, next) {
            common.napiDeleteNetworkByName({
                napi: CLIENT.napi,
                name: NETWORK1_NAME
            }, function (err) {
                t.ifError(err, 'deleteNetwork1');
                next();
            });
        },
        function deleteNetwork2(_, next) {
            common.napiDeleteNetworkByName({
                napi: CLIENT.napi,
                name: NETWORK2_NAME
            }, function (err) {
                t.ifError(err, 'deleteNetwork2');
                next();
            });
        },
        function deleteNetwork3(_, next) {
            common.napiDeleteNetworkByName({
                napi: CLIENT.napi,
                name: NETWORK3_NAME
            }, function (err) {
                t.ifError(err, 'deleteNetwork3');
                next();
            });
        },
        function deleteNicTag(_, next) {
            common.napiDeleteNicTagByName({
                napi: CLIENT.napi,
                name: NIC_TAG
            }, function (err) {
                t.ifError(err, 'deleteNicTag');
                next();
            });
        }
    ]}, cb);
}

/*
 * Create fixtures and pass them back.
 *
 * @param t
 * @param cb {Function} `function (err, fixtures)`
 */
function createFixtures(t, cb) {
    var fixtures = {};
    vasync.pipeline({funcs: [
        function mkTestNicTag(_, next) {
            CLIENT.napi.createNicTag(NIC_TAG, function (err, nicTag) {
                t.ifError(err, 'createFixtures: ' + NIC_TAG);
                t.ok(nicTag, 'createFixtures: nicTag');
                fixtures.nicTag = nicTag;
                next(err);
            });
        },
        function mkTestNetwork1(_, next) {
            createTestNetwork(NETWORK1_NAME, 90, function (err, net) {
                t.ifError(err, 'createFixtures: ' + NETWORK1_NAME);
                t.ok(net, 'createFixtures: network1');
                fixtures.network1 = net;
                next(err);
            });
        },
        function mkTestNetwork2(_, next) {
            createTestNetwork(NETWORK2_NAME, 91, function (err, net) {
                t.ifError(err, 'createFixtures: ' + NETWORK2_NAME);
                t.ok(net, 'createFixtures: network2');
                fixtures.network2 = net;
                next(err);
            });
        },
        function mkTestNetwork3(_, next) {
            var params = {
                owner_uuids: [ CLIENT.account.uuid ],
                gateway: '10.99.92.1'
            };
            createTestNetwork(NETWORK3_NAME, 92, params, function (err, net) {
                t.ifError(err, 'createFixtures: ' + NETWORK3_NAME);
                t.ok(net, 'createFixtures: network3');
                fixtures.network3 = net;
                next(err);
            });
        },
        function mkTestPool1(_, next) {
            var params = {
                name: POOL1_NAME,
                networks: [ fixtures.network1.uuid ]
            };
            CLIENT.napi.createNetworkPool(params.name, params,
                    function (err, pool) {
                t.ifError(err, 'createFixtures: ' + params.name);
                t.ok(pool, 'createFixtures: pool');
                fixtures.pool1 = pool;
                next(err);
            });
        },
        function mkTestZoneIP1(_, next) {
            var params = {
                owner_uuid: CLIENT.account.uuid,
                belongs_to_type: 'zone',
                belongs_to_uuid: ZONE_UUID1
            };
            CLIENT.napi.updateIP(fixtures.network1.uuid, ZONE_IP1, params,
                    function (err, ip) {
                t.ifError(err, 'createFixtures: zone ip ' + ZONE_IP1);
                t.ok(ip, 'createFixtures: reserved ip');
                fixtures.ip2 = ip;
                next(err);
            });
        },
        /*
         * Used to ensure a ListNetworkIPs doesn't leak other customers IPs
         * on a public network
         */
        function mkTestZoneIP2(_, next) {
            var params = {
                owner_uuid: OTHER.account.uuid,
                belongs_to_type: 'zone',
                belongs_to_uuid: ZONE_UUID2
            };
            CLIENT.napi.updateIP(fixtures.network1.uuid, ZONE_IP2, params,
                    function (err, ip) {
                t.ifError(err, 'createFixtures: zone ip ' + ZONE_IP2);
                t.ok(ip, 'createFixtures: reserved ip');
                fixtures.ip3 = ip;
                next(err);
            });
        },
        function reserveIP(_, next) {
            var params = {
                reserved: true
            };
            CLIENT.napi.updateIP(fixtures.network3.uuid, RESERVED_IP, params,
                    function (err, ip) {
                t.ifError(err, 'createFixtures: reserved ip ' + RESERVED_IP);
                t.ok(ip, 'createFixtures: reserved ip');
                fixtures.ip1 = ip;
                next(err);
            });
        },
        function getViewableNetworks(_, next) {
            CLIENT.napi.listNetworks({
                provisionable_by: CLIENT.account.uuid
            }, function (err, nets) {
                t.ifError(err, 'createFixtures: viewable networks');
                if (err) {
                    next(err);
                    return;
                }

                CLIENT.napi.listNetworkPools({
                    provisionable_by: CLIENT.account.uuid
                }, function (err2, pools) {
                    t.ifError(err2, 'createFixtures: viewable pools');
                    if (err2) {
                        next(err2);
                        return;
                    }
                    fixtures.viewableNetworks = nets.concat(pools);
                    next();
                });
            });
        }
    ]}, function (err) {
        t.ifError(err, 'createFixtures');
        cb(err, fixtures);
    });
}


function createTestNetwork(name, octet, params, cb) {
    if (typeof (params) === 'function') {
        cb = params;
        params = undefined;
    }

    var _params = params || {};
    _params.name = name;
    _params.vlan_id =  59;
    _params.subnet = '10.99.' + octet + '.0/24';
    _params.provision_start_ip = '10.99.' + octet + '.5';
    _params.provision_end_ip = '10.99.' + octet + '.250';
    _params.nic_tag = NIC_TAG;

    CLIENT.napi.createNetwork(_params, cb);
}


function getViewableUuids(t, nets, accountUuid) {
    var viewableUuids = nets.filter(function (net) {
        if (net.owner_uuids && net.owner_uuids.indexOf(accountUuid) === -1) {
            t.ok(false, format('NAPI ListNetworks and/or ListNetworkPools '
                + 'included networks owned by '
                + 'someone else: accountUuid=%s, unexpected network=%j',
                accountUuid, net));
            return false;
        }
        return true;
    }).map(function (net) {
        return net.uuid;
    });

    return viewableUuids;
}

function checkNetwork(t, net) {
    t.ok(net, 'Network OK');
    t.ok(net.name, 'Network name OK');
    t.ok(net.id, 'Network id OK');
    t.ok(net['public'] !== undefined, 'Network public');
}


// --- Tests

test('networks', function (tt) {
    var fixtures;
    var firstNetId;

    tt.test('  setup', function (t) {
        vasync.pipeline({funcs: [
            function commonSetup(_, next) {
                common.setup(function (err, clients, server) {
                    t.ifError(err, 'commonSetup err');
                    t.ok(clients, 'commonSetup clients');
                    CLIENTS = clients;
                    CLIENT = clients.user;
                    SERVER = server;
                    OTHER = clients.other;
                    next();
                });
            },
            function cleanStart(_, next) {
                deleteFixtures(t, next);
            },
            function setupFixtures(_, next) {
                createFixtures(t, function (err, fixtures_) {
                    if (err) {
                        next(err);
                        return;
                    }
                    fixtures = fixtures_;
                    t.ok(fixtures, 'fixtures');
                    next();
                });
            }
        ]}, function (err) {
            t.ifError(err, 'setup');
            t.end();
        });
    });


    tt.test('  list networks', function (t) {
        var poolFound = false;
        var netFound  = false;

        CLIENT.get('/my/networks', function (err, req, res, body) {
            t.ifError(err, 'GET /my/networks error');
            t.equal(res.statusCode, 200, 'GET /my/networks status');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'GET /my/networks body');
            t.ok(Array.isArray(body), 'GET /my/networks body is an array');

            if (!Array.isArray(body)) {
                return t.end();
            }

            t.ok(body.length, 'GET /my/networks body array has elements');

            var viewableUuids = getViewableUuids(t, fixtures.viewableNetworks,
                CLIENT.account.uuid);

            body.forEach(function (n) {
                t.notEqual(viewableUuids.indexOf(n.id), -1);
                t.ok(n.id !== fixtures.network1.uuid,
                    'should not list network in pool');

                checkNetwork(t, n);

                if (n.id === fixtures.pool1.uuid) {
                    poolFound = true;
                }
                if (n.id === fixtures.network2.uuid) {
                    netFound = true;
                }
            });

            t.ok(poolFound, format('pool1 (%s, name=%s) in /my/networks',
                fixtures.pool1.uuid, POOL1_NAME)
                + (poolFound ? '' : format(': %j', body)));
            t.ok(netFound, format('network2 (%s, name=%s) in /my/networks',
                fixtures.network2.uuid, NETWORK2_NAME)
                + (netFound ? '' : format(': %j', body)));

            // This will likely be our default setup external network
            firstNetId = body[0].id;
            return t.end();
        });
    });


    tt.test('  get network', function (t) {
        CLIENT.get('/my/networks/' + firstNetId,
                function (err, req, res, body) {
            t.ifError(err, 'GET /my/networks/' + firstNetId + ' error');
            t.equal(res.statusCode, 200, 'GET /my/networks/:uuid status');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'GET /my/networks/:uuid body');
            checkNetwork(t, body);
            t.end();
        });
    });


    tt.test('  get network - no permission', function (t) {
        CLIENT.napi.listNetworks(function (err, nets) {
            t.ifError(err);

            var network = nets.filter(function (net) {
                var owners = net.owner_uuids;
                return owners && owners.indexOf(CLIENT.account.uuid) === -1;
            })[0];

            var path = '/my/networks/' + network.uuid;
            return CLIENT.get(path, function (err2, req, res, body) {
                common.checkNotFound(t, err2, req, res, body);
                t.end();
            });
        });
    });


    tt.test('  get network (404)', function (t) {
        CLIENT.get('/my/networks/' + NO_SUCH_NETWORK_UUID,
                function (err, req, res, body) {
            common.checkNotFound(t, err, req, res, body);
            t.end();
        });
    });

    tt.test('  get network ips (404)', function (t) {
        var path = format('/my/networks/%s/ips', NO_SUCH_NETWORK_UUID);
        CLIENT.get(path, function (err, req, res, body) {
            common.checkNotFound(t, err, req, res, body);
            t.end();
        });
    });

    /*
     *  On public networks we should only see provisioned ips owned
     *  by the specific user.
     */
    tt.test('  get network ips (public)', function (t) {
        var out = [
            {
                ip: ZONE_IP1,
                reserved: false,
                managed: false,
                belongs_to_uuid: ZONE_UUID1,
                owner_uuid: CLIENT.account.uuid
            }
        ];
        var path = format('/my/networks/%s/ips', fixtures.network1.uuid);
        CLIENT.get(path, function (err, req, res, body) {
            t.ifError(err, 'GET /my/networks/' + fixtures.network1.uuid +
                '/ips error');
            t.equal(res.statusCode, 200, 'GET /my/networks/:uuid/ips status');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'GET /my/networks/:uuid/ips body');
            t.deepEqual(body, out, 'ListNetworkIPs shows only reserved and '
                + 'provisioned ips OK');
            t.end();
        });
    });

    /*
     *  On private networks we should see provisioned/reserved ips
     *  as well as 'triton_protected' ips such as the broadcast/gateway
     */
    tt.test('  get network ips (owner)', function (t) {
        var out = [
            {
                ip: '10.99.92.1',
                managed: true,
                reserved: true
            },
            {
                ip: RESERVED_IP,
                managed: false,
                reserved: true
            },
            {
                ip: '10.99.92.255',
                managed: true,
                reserved: true
            }
        ];
        var path = format('/my/networks/%s/ips', fixtures.network3.uuid);
        CLIENT.get(path, function (err, req, res, body) {
            t.ifError(err, 'GET /my/networks/' + fixtures.network3.uuid +
                '/ips error');
            t.equal(res.statusCode, 200, 'GET /my/networks/:uuid/ips status');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'GET /my/networks/:uuid/ips body');
            t.deepEqual(body, out, 'ListNetworkIPs shows only reserved and '
                + 'provisioned ips OK');
            t.end();
        });
    });

    tt.test('  get network ip (404)', function (t) {
        var path = format('/my/networks/%s/ips/10.99.98.1',
            fixtures.network3.uuid);
        CLIENT.get(path, function (err, req, res, body) {
            common.checkNotFound(t, err, req, res, body);
            t.end();
        });
    });

    // GET of owned IP on public network works
    tt.test('  get ip on public network (owner)', function (t) {
        var out = {
            ip: ZONE_IP1,
            managed: false,
            reserved: false,
            belongs_to_uuid: ZONE_UUID1,
            owner_uuid: CLIENT.account.uuid
        };
        var path = format('/my/networks/%s/ips/%s', fixtures.network1.uuid,
            ZONE_IP1);
        CLIENT.get(path, function (err, req, res, body) {
            t.ifError(err, 'GET /my/networks/' + fixtures.network1.uuid +
                '/ips/' + ZONE_IP1 + ' error');
            t.equal(res.statusCode, 200,
                'GET /my/networks/:uuid/ips/:ip_address status');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'GET /my/networks/:uuid/ips/:ip_address body');
            t.deepEqual(body, out, 'GetNetworkIP works on owned IP');
            t.end();
        });
    });

    //  GET of unowned IP on a public network returns 404
    tt.test('  get ip on public network (not owner)', function (t) {
        var path = format('/my/networks/%s/ips/%s', fixtures.network1.uuid,
            ZONE_IP2);
        CLIENT.get(path, function (err, req, res, body) {
            common.checkNotFound(t, err, req, res, body);
            t.end();
        });
    });

    // GET of IP on private network works
    tt.test('  get ip on private network (owner)', function (t) {
        var out = {
            ip: RESERVED_IP,
            reserved: true,
            managed: false
        };
        var path = format('/my/networks/%s/ips/%s', fixtures.network3.uuid,
            RESERVED_IP);
        CLIENT.get(path, function (err, req, res, body) {
            t.ifError(err, 'GET /my/networks/' + fixtures.network3.uuid +
                '/ips/' + RESERVED_IP + ' error');
            t.equal(res.statusCode, 200,
                'GET /my/networks/:uuid/ips/:ip_address status');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'GET /my/networks/:uuid/ips/:ip_address body');
            t.deepEqual(body, out, 'GetNetworkIP works on private network');
            t.end();
        });
    });

    tt.test('  teardown', function (t) {
        vasync.pipeline({ funcs: [
            function teardownFixtures(_, next) {
                deleteFixtures(t, next);
            },
            function commonTeardown(_, next) {
                common.teardown(CLIENTS, SERVER, next);
            }
        ]}, function (err) {
            t.ifError(err);
            t.end();
        });
    });

});
