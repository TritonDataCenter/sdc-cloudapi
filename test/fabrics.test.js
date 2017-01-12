/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var clone = require('clone');
var fmt = require('util').format;
var test = require('tape').test;
var vasync = require('vasync');

var common = require('./common');
var mod_testNetworks = require('./lib/networks');

var checkNotFound = common.checkNotFound;


// --- Globals

var CLIENT;
var OTHER;
var CLIENTS;
var CREATED = {
    nets: [],
    vlans: []
};
var DEFAULT_NET;
var PARAMS = {
    nets: [
        {
            name: 'network_0',
            provision_start_ip: '10.4.1.0',
            provision_end_ip: '10.4.255.254',
            resolvers: ['8.8.8.8'],
            subnet: '10.4.0.0/16'
        },

        // "Fully loaded" network - all properties present
        {
            name: 'network_1',
            description: 'the number one network',
            gateway: '10.5.1.1',
            provision_start_ip: '10.5.1.0',
            provision_end_ip: '10.5.255.254',
            resolvers: ['8.8.8.8'],
            routes: {
                '10.4.0.0/16': '10.5.1.1'
            },
            subnet: '10.5.0.0/16'
        }
    ],
    vlan: {
        name: 'my_vlan',
        description: 'some description',
        vlan_id: 4000
    }
};
var SERVER;
// String limit in NAPI is 64 characters:
var SIXTEEN = 'xxxxxxxxxxxxxxxx';
var TOO_LONG_STR = SIXTEEN + SIXTEEN + SIXTEEN + SIXTEEN + 'x';
// if fabrics aren't enabled, there's no point running these tests
var TEST_OPTS = {
    skip: !common.getCfg().fabrics_enabled
};


// --- Helpers


/**
 * Some attributes don't exist in the request, but do in the results. When
 * comparing request with results, we want to add these attributes in.
 */
function addNetOutputAttr(net) {
    net = clone(net);
    net.internet_nat = true;
    return net;
}


function afterFindInList(t, legitUuids, params, callback, err, req, res, body) {
    var found;

    t.ifError(err, 'GET error');
    t.equal(res.statusCode, 200, 'GET status');
    common.checkHeaders(t, res.headers);
    common.checkReqId(t, res.headers);

    t.ok(body, 'GET body');
    t.ok(Array.isArray(body), 'GET body is an array');
    if (!Array.isArray(body)) {
        if (callback) {
            return callback(err);
        }

        return t.end();
    }

    t.ok(body.length, 'GET body array has elements');

    body.forEach(function (net) {
        t.notEqual(legitUuids.indexOf(net.id), -1,
            fmt('network %s from CloudAPI network listing is in legitUuids: %j',
                net.id, legitUuids));

        if (net.name === params.name) {
            found = net;

            // Cover the case (like the default network) where we don't
            // know the id of the thing we're trying to compare:
            if (net.id && !params.id) {
                params.id = net.id;
            }

            t.deepEqual(net, params, 'params');
        }
    });

    t.ok(found, 'found ' + params.name);

    if (callback) {
        return callback(null, found);
    }

    return t.end();
}


/**
 * Change the default network
 */
function changeDefaultNet(t, net) {
    var params = {
        default_network: net.id
    };

    CLIENT.put('/my/config', params, checkConfig.bind(null, t, params));
}


/**
 * Check config params - intended to be bound to an API function call
 */
function checkConfig(t, params, err, req, res, body) {
    t.ifErr(err, 'getting config');
    common.checkHeaders(t, res.headers);
    common.checkReqId(t, res.headers);

    t.ok(body, 'PUT body');
    t.ok(typeof (body), 'object', 'PUT body is an object');
    t.deepEqual(body, params, 'body is correct');

    return t.end();
}


/**
 * Check the default network matches the one in /my/config
 */
function checkDefaultNet(t, net) {
    var params = {
        default_network: net.id
    };

    CLIENT.get('/my/config', checkConfig.bind(null, t, params));
}


/**
 * Temporarily remove dclocalconfig before invoking testFunc(). Add it back when
 * done.
 */
function withoutDcLocalConfig(testFunc, cb) {
    var accountUuid = CLIENT.account.uuid;
    var dc = CLIENT.datacenter;
    var ufds = CLIENT.ufds;
    var config;

    var pollGoneCount = 20;
    var pollPresentCount = 20;
    var pollInterval = 500; // in ms

    vasync.pipeline({ funcs: [
        function getConf(_, next) {
            ufds.getDcLocalConfig(accountUuid, dc, function (err, _config) {
                config = _config;
                next(err);
            });
        },
        function deleteConf(_, next) {
            ufds.deleteDcLocalConfig(accountUuid, dc, next);
        },
        function pollConfGone(_, next) {
            --pollGoneCount;
            if (pollGoneCount === 0) {
                next(new Error('dclocalconfig took too long to remove'));
                return;
            }

            ufds.getDcLocalConfig(accountUuid, dc, function (err) {
                if (err) {
                    next(err.restCode === 'ResourceNotFound' ? null : err);
                    return;
                }

                setTimeout(pollConfGone.bind(null, _, next), pollInterval);
            });
        },
        function runTestFunc(_, next) {
            testFunc(null, next);
        },
        function addConf(_, next) {
            ufds.addDcLocalConfig(accountUuid, dc, config, next);
        },
        function pollConfPresent(_, next) {
            --pollPresentCount;
            if (pollPresentCount === 0) {
                next(new Error('dclocalconfig took too long to return'));
                return;
            }

            ufds.getDcLocalConfig(accountUuid, dc, function (err) {
                if (err) {
                    if (err.restCode === 'ResourceNotFound') {
                        setTimeout(pollConfPresent.bind(null, _, next),
                            pollInterval);
                    } else {
                        next(err);
                    }
                    return;
                }

                next();
            });
        }
    ]}, cb);
}


/**
 * Find a fabric network in a user's overall network list
 */
function findNetInList(t, params, callback) {
    assert.object(t, 't');
    assert.object(params, 'params');
    assert.string(params.name, 'params.name');

    var accountUuid = CLIENT.account.uuid;

    findViewableNetworks(t, accountUuid, function (err, nets) {
        var viewableUuids = getViewableUuids(t, nets, accountUuid);

        CLIENT.get('/my/networks', afterFindInList.bind(null, t,
                    viewableUuids, params, callback));
    });
}


/**
 * Find a fabric network in a user's fabric network list
 */
function findNetInFabricList(t, params, callback) {
    assert.object(t, 't');
    assert.object(params, 'params');
    assert.number(params.vlan_id, 'params.vlan_id');
    assert.string(params.name, 'params.name');

    var accountUuid = CLIENT.account.uuid;

    // check that every network in body should be viewable by this user
    CLIENT.napi.listFabricNetworks(accountUuid, params.vlan_id, {},
            function (err, nets) {
        t.ifError(err);

        var viewableUuids = getViewableUuids(t, nets, accountUuid);

        CLIENT.get(fmt('/my/fabrics/default/vlans/%d/networks', params.vlan_id),
            afterFindInList.bind(null, t, viewableUuids, params, callback));
    });
}


/**
 * Fetch all networks and pools from napi that a given account should be able to
 * see.
 */
function findViewableNetworks(t, accountUuid, cb) {
    // check that every network in body should be viewable by this user
    CLIENT.napi.listNetworks({ provisionable_by: accountUuid },
            function (err, nets) {
        t.ifError(err);

        CLIENT.napi.listNetworkPools(function (err2, pools) {
            t.ifError(err2);
            cb(null, nets.concat(pools));
        });
    });
}


/**
 * Find a fabric VLAN in a user's list
 */
function findVLANinList(t, params, callback) {
    assert.object(t, 't');
    assert.object(params, 'params');
    assert.number(params.vlan_id, 'params.vlan_id');

    var accountUuid = CLIENT.account.uuid;

    CLIENT.napi.listFabricVLANs(accountUuid, {}, function (err, vlans) {
        t.ifError(err);

        var viewableIds = vlans.map(function (vlan) {
            t.equal(vlan.owner_uuid, accountUuid, 'vlan belongs to account');
            return vlan.vlan_id;
        });

        var path = '/my/fabrics/default/vlans';
        CLIENT.get(path, function (err2, req, res, body) {
            t.ifError(err2, 'GET error');
            t.equal(res.statusCode, 200, 'GET status');
            common.checkHeaders(t, res.headers);
            common.checkReqId(t, res.headers);

            t.ok(Array.isArray(body), 'GET body is an array');
            t.ok(body.length, 'GET body array has elements');

            var found = body.filter(function (vlan) {
                // this check is more a sanity check than a proper ownership
                // check, since VLANs from different owners can have the same
                // ids
                t.notEqual(viewableIds.indexOf(vlan.vlan_id), -1,
                    fmt('VLAN %s from CloudAPI VLAN listing is in '
                        + 'viewableIds: %j', vlan.vlan_id, viewableIds));

                if (vlan.name === params.name) {
                    t.deepEqual(vlan, params, 'params');
                    return true;
                }

                return false;
            })[0];

            t.ok(found, 'found ' + params.name);

            t.end();
        });
    });
}


/**
 * Get a list of network UUIDs which this user is allowed to read.
 */
function getViewableUuids(t, nets, accountUuid) {
    var viewableUuids = nets.filter(function (net) {
        if (net.owner_uuids && net.owner_uuids.indexOf(accountUuid) === -1) {
            t.ok(false, fmt('account %s is in network %s "owner_uuids": %j',
                accountUuid, net.uuid, net.owner_uuids));
            return false;
        }
        return true;
    }).map(function (net) {
        return net.uuid;
    });

    return viewableUuids;
}


/**
 * Return a json-schema "property missing" message
 */
function ipMsg(prop) {
    return fmt('property "%s": must be an IPv4 address', prop);
}


/**
 * Return a json-schema "property missing" message
 */
function missingMsg(prop) {
    return fmt('property "%s": is missing and it is required', prop);
}


/**
 * Return a "string is too long" message
 */
function tooLongMsg(prop) {
    return fmt('property "%s": must not be longer than 64 characters', prop);
}


/**
 * Return a "type doesn't match" json-schema message
 */
function typeMsg(prop, found, exp) {
    return fmt('property "%s": %s value found, but a %s is required',
            prop, found, exp);
}


// --- Tests


test('setup', TEST_OPTS, function (t) {
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        SERVER  = server;

        CLIENT = clients.user;
        OTHER  = clients.other;

        t.end();
    });
});


test('VLANs', TEST_OPTS, function (tt) {

    tt.test('create fabric VLAN', function (t) {
        CLIENT.post('/my/fabrics/default/vlans', PARAMS.vlan,
                function (err, req, res, body) {
            t.ifErr(err, 'create VLAN');

            t.equal(res.statusCode, 201, 'create fabric VLAN');
            common.checkHeaders(t, res.headers);
            common.checkReqId(t, res.headers);
            t.deepEqual(body, PARAMS.vlan, 'response');
            if (body && body.vlan_id) {
                CREATED.vlans.push(body);
            }

            t.end();
        });
    });


    tt.test('get fabric VLAN', function (t) {
        CLIENT.get('/my/fabrics/default/vlans/' + PARAMS.vlan.vlan_id,
                function (err, req, res, body) {
            t.ifErr(err, 'get VLAN');

            t.equal(res.statusCode, 200, 'get fabric VLAN');
            common.checkHeaders(t, res.headers);
            common.checkReqId(t, res.headers);
            t.deepEqual(body, PARAMS.vlan, 'response');

            t.end();
        });
    });


    tt.test('get fabric VLAN - other', function (t) {
        OTHER.get('/my/fabrics/default/vlans/' + PARAMS.vlan.vlan_id,
                function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    tt.test('VLAN exists in list', function (t) {
        findVLANinList(t, PARAMS.vlan);
    });


    tt.test('VLAN exists in list - other', function (t) {
        OTHER.get('/my/fabrics/default/vlans', function (err, req, res, body) {
            t.ifError(err);

            // there's a race here between this test running and a default VLAN
            // being created for the new OTHER user (happens to all users)
            if (body.length === 1) {
                t.deepEqual(body, [ {
                    name: 'My-Fabric-VLAN',
                    vlan_id: 2
                } ]);
            } else {
                t.equal(body.length, 0);
            }

            t.end();
        });
    });


    tt.test('update fabric VLAN', function (t) {
        var updateParams = {
            name: 'new_vlan_name',
            description: 'new description'
        };

        CLIENT.put('/my/fabrics/default/vlans/' + PARAMS.vlan.vlan_id,
                updateParams, function (err, req, res, body) {
            t.ifErr(err, 'update VLAN');

            t.equal(res.statusCode, 202, 'update fabric VLAN');
            common.checkHeaders(t, res.headers);
            common.checkReqId(t, res.headers);

            PARAMS.vlan.name = updateParams.name;
            PARAMS.vlan.description = updateParams.description;
            t.deepEqual(body, PARAMS.vlan, 'response');

            t.end();
        });
    });


    tt.test('update fabric VLAN - other', function (t) {
        var updateParams = {
            name: 'new_vlan_name',
            description: 'new description'
        };

        OTHER.put('/my/fabrics/default/vlans/' + PARAMS.vlan.vlan_id,
                updateParams, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    tt.test('delete fabric VLAN - other', function (t) {
        OTHER.del('/my/fabrics/default/vlans/' + PARAMS.vlan.vlan_id,
                function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    tt.test('delete non-existent fabric VLAN', function (t) {
        CLIENT.del('/my/fabrics/default/vlans/999',
                function (err, req, res, body) {
            t.ok(err, 'expected error');

            if (err) {
                t.equal(err.message, 'vlan not found', 'error message');
                t.equal(err.restCode, 'ResourceNotFound', 'restCode');
                t.equal(err.statusCode, 404, 'statusCode');
            }

            t.end();
        });
    });

});


test('create VLAN: invalid', TEST_OPTS, function (t) {
    var invalid = [
        // name
        [ {vlan_id: 4}, missingMsg('name')],
        [ {vlan_id: 4, name: 5}, typeMsg('name', 'number', 'string')],

        // vlan_id
        [ {name: 'asdf'}, missingMsg('vlan_id')],
        [ {name: TOO_LONG_STR, vlan_id: 5}, tooLongMsg('name')],
        [ {name: 'asdf', vlan_id: 'foo'},
            typeMsg('vlan_id', 'string', 'integer')],

        // description
        [ {name: 'foo', vlan_id: 6, description: TOO_LONG_STR},
            tooLongMsg('description')]
    ];

    function _createInvalidVLAN(data, cb) {
        CLIENT.post('/my/fabrics/default/vlans', data[0],
                function (err, req, res, body) {

            t.ok(err, 'expected error: ' + JSON.stringify(data[0]));
            if (err) {
                t.equal(err.message, data[1], 'error message');
                t.equal(err.restCode, 'InvalidArgument', 'restCode');
                t.equal(err.statusCode, 409, 'statusCode');
            }

            cb();
        });
    }

    vasync.forEachParallel({
        inputs: invalid,
        func: _createInvalidVLAN
    }, function () {
        t.end();
    });
});


test('update VLAN: invalid', TEST_OPTS, function (t) {
    var invalid = [
        // name
        [ {name: 5}, typeMsg('name', 'number', 'string'), 409 ],
        [ {name: TOO_LONG_STR}, tooLongMsg('name'), 409 ],

        // description
        [ {description: 5}, typeMsg('description', 'number', 'string'), 409 ],
        [ {description: TOO_LONG_STR}, tooLongMsg('description'), 409 ],

        // vlan_id
        [ {vlan_id: 10}, 'vlan not found', 404 ]
    ];

    function _updateInvalidVLAN(data, cb) {
        CLIENT.put('/my/fabrics/default/vlans/' + PARAMS.vlan.vlan_id, data[0],
                function (err, req, res, body) {

            t.ok(err, 'expected error: ' + JSON.stringify(data[0]));
            if (err) {
                t.equal(err.message, data[1], 'error message');
                t.equal(err.statusCode, data[2], 'statusCode');

                var restCode = (data[2] === 404 ?
                                'ResourceNotFound' :
                                'InvalidArgument');
                t.equal(err.restCode, restCode, 'restCode');
            }

            cb();
        });
    }

    vasync.forEachParallel({
        inputs: invalid,
        func: _updateInvalidVLAN
    }, function () {
        t.end();
    });
});


test('networks', TEST_OPTS, function (tt) {

    var nets = [];

    tt.test('create fabric network 0 - other', function (t) {
        OTHER.post(fmt('/my/fabrics/default/vlans/%d/networks',
                PARAMS.vlan.vlan_id), PARAMS.nets[0],
                function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    tt.test('create fabric network 0', function (t) {
        CLIENT.post(fmt('/my/fabrics/default/vlans/%d/networks',
                PARAMS.vlan.vlan_id), PARAMS.nets[0],
                function (err, req, res, body) {
            t.ifErr(err, 'create fabric network');

            t.equal(res.statusCode, 201, 'create fabric network');
            common.checkHeaders(t, res.headers);
            common.checkReqId(t, res.headers);

            if (body) {
                t.ok(body.id, 'id present');
                PARAMS.nets[0].id = body.id;
            }
            PARAMS.nets[0].fabric = true;
            PARAMS.nets[0].public = false;
            PARAMS.nets[0].vlan_id = PARAMS.vlan.vlan_id;

            t.deepEqual(body, addNetOutputAttr(PARAMS.nets[0]), 'response');

            if (body && body.id) {
                CREATED.nets.push(body);
                nets.push(body.id);
            }

            return t.end();
        });
    });


    tt.test('get fabric network 0', function (t) {
        if (!nets[0]) {
            t.end();
            return;
        }

        CLIENT.get(fmt('/my/fabrics/default/vlans/%d/networks/%s',
                PARAMS.vlan.vlan_id, nets[0]), function (err, req, res, body) {
            t.ifErr(err, 'get fabric network');

            t.equal(res.statusCode, 200, 'get fabric network');
            common.checkHeaders(t, res.headers);
            common.checkReqId(t, res.headers);

            t.deepEqual(body, addNetOutputAttr(PARAMS.nets[0]), 'response');

            return t.end();
        });
    });


    tt.test('get fabric network 0 - other', function (t) {
        if (!nets[0]) {
            t.end();
            return;
        }

        OTHER.get(fmt('/my/fabrics/default/vlans/%d/networks/%s',
                PARAMS.vlan.vlan_id, nets[0]), function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    tt.test('create fabric network 1', function (t) {
        CLIENT.post(fmt('/my/fabrics/default/vlans/%d/networks',
                PARAMS.vlan.vlan_id), PARAMS.nets[1],
                function (err, req, res, body) {
            t.ifErr(err, 'create fabric network');

            t.equal(res.statusCode, 201, 'create fabric network');
            common.checkHeaders(t, res.headers);
            common.checkReqId(t, res.headers);

            if (body) {
                t.ok(body.id, 'id present');
                PARAMS.nets[1].id = body.id;
            }
            PARAMS.nets[1].fabric = true;
            PARAMS.nets[1].public = false;
            PARAMS.nets[1].vlan_id = PARAMS.vlan.vlan_id;

            t.deepEqual(body, addNetOutputAttr(PARAMS.nets[1]), 'response');

            if (body && body.id) {
                CREATED.nets.push(body);
                nets.push(body.id);
            }

            return t.end();
        });
    });


    tt.test('get fabric network 1', function (t) {
        if (!nets[1]) {
            t.end();
            return;
        }

        CLIENT.get(fmt('/my/fabrics/default/vlans/%d/networks/%s',
                PARAMS.vlan.vlan_id, nets[1]), function (err, req, res, body) {
            t.ifErr(err, 'get fabric network');

            t.equal(res.statusCode, 200, 'get fabric network');
            common.checkHeaders(t, res.headers);
            common.checkReqId(t, res.headers);

            t.deepEqual(body, addNetOutputAttr(PARAMS.nets[1]), 'response');

            return t.end();
        });
    });


    tt.test('fabric network 0 exists in main list', function (t) {
        findNetInList(t, addNetOutputAttr(PARAMS.nets[0]));
    });


    tt.test('fabric network 1 exists in main list', function (t) {
        findNetInList(t, addNetOutputAttr(PARAMS.nets[1]));
    });


    tt.test('filtering networks by fabric=true', function (t) {
        CLIENT.get('/my/networks?fabric=true', function (err, req, res, body) {
            t.ifErr(err, 'get networks');
            t.equal(res.statusCode, 200, 'get fabric VLAN');
            common.checkHeaders(t, res.headers);
            common.checkReqId(t, res.headers);

            var accountUuid = CLIENT.account.uuid;

            findViewableNetworks(t, accountUuid, function (err2, networks) {
                t.ifError(err2);

                var viewableUuids = getViewableUuids(t, networks, accountUuid);

                var fabricNets = [];
                var nonFabricNets = [];

                for (var n in body) {
                    t.notEqual(viewableUuids.indexOf(body[n].id), -1);

                    if (body[n].fabric) {
                        fabricNets.push(body[n]);
                    } else {
                        nonFabricNets.push(body[n]);
                    }
                }

                t.ok(body.length > 0, 'at least one network returned');
                t.equal(fabricNets.length, body.length,
                    'only fabric networks returned');
                t.deepEqual(nonFabricNets, [],
                    'no non-fabric networks returned');

                t.end();
            });
        });
    });


    tt.test('create fabric network: overlapping', function (t) {
        var params = {
            name: 'overlap_network',
            provision_start_ip: '10.5.1.0',
            provision_end_ip: '10.5.1.250',
            resolvers: ['8.8.8.8'],
            subnet: '10.5.1.0/24'
        };

        CLIENT.post(fmt('/my/fabrics/default/vlans/%d/networks',
                PARAMS.vlan.vlan_id), params, function (err, req, res, body) {
            t.ok(err, 'expected error');

            if (err) {
                t.equal(err.message,
                    'property "subnet": subnet overlaps with another network',
                    'error message');
                t.equal(err.restCode, 'InvalidArgument', 'restCode');
                t.equal(err.statusCode, 409, 'statusCode');
            }

            if (body && body.id) {
                CREATED.nets.push(body);
            }

            return t.end();
        });
    });


    tt.test('create fabric network: overlapping - other', function (t) {
        var params = {
            name: 'overlap_network',
            provision_start_ip: '10.5.1.0',
            provision_end_ip: '10.5.1.250',
            resolvers: ['8.8.8.8'],
            subnet: '10.5.1.0/24'
        };

        OTHER.post(fmt('/my/fabrics/default/vlans/%d/networks',
                PARAMS.vlan.vlan_id), params, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });
});


test('create fabric network: invalid', TEST_OPTS, function (t) {
    var base = {
        name: 'invalid_network',
        provision_start_ip: '192.168.1.1',
        provision_end_ip: '192.168.1.250',
        resolvers: ['8.8.8.8'],
        subnet: '192.168.1.0/24'
    };

    function delParam(par) {
        var newParams = clone(base);
        delete newParams[par];

        return newParams;
    }

    function addParams(params) {
        var newParams = clone(base);
        for (var p in params) {
            newParams[p] = params[p];
        }

        return newParams;
    }

    var invalid = [
        // name
        [delParam('name'), missingMsg('name')],
        [addParams({name: TOO_LONG_STR}), tooLongMsg('name')],
        [addParams({name: 5}), typeMsg('name', 'number', 'string')],

        // provision_start_ip
        [delParam('provision_start_ip'), missingMsg('provision_start_ip')],
        [addParams({provision_start_ip: 'a'}), ipMsg('provision_start_ip')],

        // provision_end_ip
        [delParam('provision_end_ip'), missingMsg('provision_end_ip')],
        [addParams({provision_end_ip: 'a'}), ipMsg('provision_end_ip')],

        // resolvers
        [addParams({resolvers: 'a'}),
            typeMsg('resolvers', 'string', 'array')],
        [addParams({resolvers: ['a']}), ipMsg('resolvers[0]')],
        [addParams({resolvers: ['1.2.3.4', '1.2.3.4', '1.2.3.4', 'a']}),
            ipMsg('resolvers[3]')],
        [addParams({resolvers: ['1.2.3.4', '1.2.3.4', '1.2.3.4', '1.2.3.4',
            '1.2.3.4']}), 'property "resolvers": maximum of 4 resolvers'],

        // subnet
        [delParam('subnet'), missingMsg('subnet')],
        [addParams({subnet: 'a'}),
            'property "subnet": Subnet must be in CIDR form'],

        // description
        [addParams({description: TOO_LONG_STR}), tooLongMsg('description')],
        [addParams({description: 5}),
            typeMsg('description', 'number', 'string')],

        // routes
        [addParams({routes: 'a'}), typeMsg('routes', 'string', 'object')],
        [addParams({routes: {a: 'b'}}), 'property "routes": invalid route']
    ];

    function _createInvalidNet(data, cb) {
        CLIENT.post(fmt('/my/fabrics/default/vlans/%d/networks',
                PARAMS.vlan.vlan_id), data[0], function (err, req, res, body) {

            t.ok(err, 'expected error: ' + JSON.stringify(data[0]));
            if (err) {
                t.equal(err.message, data[1], 'error message');
                t.equal(err.restCode, 'InvalidArgument', 'restCode');
                t.equal(err.statusCode, 409, 'statusCode');
            }

            cb();
        });
    }

    vasync.forEachParallel({
        inputs: invalid,
        func: _createInvalidNet
    }, function () {
        return t.end();
    });
});


test('default fabric', TEST_OPTS, function (tt) {
    var defaultNet = {
        fabric: true,
        gateway: '192.168.128.1',
        name: 'My-Fabric-Network',
        provision_end_ip: '192.168.131.250',
        provision_start_ip: '192.168.128.5',
        public: false,
        internet_nat: true,
        resolvers: ['8.8.8.8', '8.8.4.4'],
        subnet: '192.168.128.0/22',
        vlan_id: 2
    };
    var defaultVLAN = {
        name: 'My-Fabric-VLAN',
        vlan_id: 2
    };

    // The default vlan for a user is created
    tt.test('wait for default VLAN creation', function (t) {
        mod_testNetworks.waitForDefaultVLAN(CLIENT, t);
    });


    tt.test('default VLAN exists', function (t) {
        findVLANinList(t, defaultVLAN);
    });


    tt.test('default network exists', function (t) {
        findNetInFabricList(t, defaultNet);
    });


    tt.test('default network exists in main list', function (t) {
        findNetInList(t, defaultNet, function _afterListDefault(_, net) {
            if (net) {
                DEFAULT_NET = net;
            }

            t.end();
        });
    });


    tt.test('change default network', function (t) {
        if (!DEFAULT_NET) {
            t.fail('default vlan not found: skipping test');
            t.end();
            return;
        }

        changeDefaultNet(t, CREATED.nets[0]);
    });


    tt.test('change default network - other', function (t) {
        if (!DEFAULT_NET) {
            t.fail('default vlan not found: skipping test');
            t.end();
            return;
        }

        OTHER.put('/my/config', {
            default_network: CREATED.nets[0].id
        }, function (err, req, res, body) {
            t.ok(err);
            t.equal(res.statusCode, 409);

            t.equal(err.restCode, 'InvalidArgument');
            t.ok(err.message);

            t.equal(body.code, 'InvalidArgument');
            t.ok(body.message);

            t.end();
        });
    });


    tt.test('confirm default network change', function (t) {
        if (!DEFAULT_NET) {
            t.fail('default vlan not found: skipping test');
            t.end();
            return;
        }

        checkDefaultNet(t, CREATED.nets[0]);
    });


    // Not allowed to delete a network if it's set to be the default
    tt.test('attempt to delete default network', function (t) {
        if (!DEFAULT_NET) {
            t.fail('default vlan not found: skipping test');
            t.end();
            return;
        }

        var net = CREATED.nets[0];

        CLIENT.del(fmt('/my/fabrics/default/vlans/%d/networks/%s',
                net.vlan_id, net.id), function (err, req, res, body) {
            t.ok(err, 'delete network');
            common.checkHeaders(t, res.headers);
            common.checkReqId(t, res.headers);

            if (err) {
                t.equal(err.message, 'cannot delete default network',
                        'error message');
                t.equal(err.restCode, 'InvalidArgument', 'restCode');
                t.equal(err.statusCode, 409, 'statusCode');
            }

            return t.end();
        });
    });


    tt.test('attempt to delete default network - other', function (t) {
        if (!DEFAULT_NET) {
            t.fail('default vlan not found: skipping test');
            t.end();
            return;
        }

        var net = CREATED.nets[0];

        OTHER.del(fmt('/my/fabrics/default/vlans/%d/networks/%s',
                net.vlan_id, net.id), function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    tt.test('change default network back', function (t) {
        if (!DEFAULT_NET) {
            t.fail('default vlan not found: skipping test');
            t.end();
            return;
        }

        changeDefaultNet(t, DEFAULT_NET);
    });


    tt.test('attempt to GET/PUT a config when missing dclocalconfig',
    function (t) {
        if (!DEFAULT_NET) {
            t.fail('default vlan not found: skipping test');
            t.end();
            return;
        }

        withoutDcLocalConfig(function (_, next) {
            CLIENT.get('/my/config', function (err, req, res, config) {
                t.ifError(err, 'GET Error');
                t.equal(res.statusCode, 200, 'GET status');

                t.deepEqual(config, {});

                CLIENT.put('/my/config', {
                    default_network: DEFAULT_NET.id
                }, function (err2, req2, res2, body) {
                    t.ok(err2, 'PUT Error expected');
                    t.equal(res2.statusCode, 500, 'PUT status');
                    t.deepEqual(body, {
                        code: 'InternalError',
                        message: 'Config currently unavailable.'
                    });

                    next();
                });
            });
        }, function (err) {
            t.ifError(err, 'Error while running without dclocalconfig');
            t.end();
        });
    });
});


test('teardown', TEST_OPTS, function (tt) {

    tt.test('delete networks', function (t) {
        if (CREATED.nets.length === 0) {
            t.end();
            return;
        }

        function _delNet(net, cb) {
            CLIENT.del(fmt('/my/fabrics/default/vlans/%d/networks/%s',
                    net.vlan_id, net.id), function (err, req, res, body) {
                t.ifErr(err, 'delete network ' + net.id);

                t.equal(res.statusCode, 204, 'delete fabric network');
                common.checkHeaders(t, res.headers);
                common.checkReqId(t, res.headers);
                t.deepEqual(body, {}, 'response');

                cb();
            });
        }

        vasync.forEachParallel({
            inputs: CREATED.nets,
            func: _delNet
        }, function () {
            return t.end();
        });
    });


    tt.test('delete vlans', function (t) {
        if (CREATED.vlans.length === 0) {
            t.end();
            return;
        }

        function _delVlan(vlan, cb) {
            CLIENT.del(fmt('/my/fabrics/default/vlans/%d', vlan.vlan_id),
                    function (err, req, res, body) {
                t.ifErr(err, 'delete vlan');

                t.equal(res.statusCode, 204, 'delete fabric vlan');
                common.checkHeaders(t, res.headers);
                common.checkReqId(t, res.headers);
                t.deepEqual(body, {}, 'response');

                cb();
            });
        }

        vasync.forEachParallel({
            inputs: CREATED.vlans,
            func: _delVlan
        }, function () {
            return t.end();
        });
    });

    tt.test('client and server teardown', function (t) {
        common.teardown(CLIENTS, SERVER, function (err) {
            t.ifError(err, 'teardown success');
            t.end();
        });
    });

});
