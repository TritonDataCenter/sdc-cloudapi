/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var test = require('tape').test;
var format = require('util').format;
var plugin = require('../../plugins/filter_owner_networks');


// --- Globals

var ACCOUNT = { uuid: '572c169e-a287-11e7-b95d-28cfe91f7d53' };
var OTHER_ACCOUNT = { uuid: '5cc54706-a287-11e7-b33c-28cfe91f7d53' };

var NETWORKS = [ {
    uuid: '22a0b5fa-a292-11e7-8911-28cfe91f7d53',
    owner_uuids: [ACCOUNT.uuid],
    nic_tag: 'internal'
}, {
    uuid: '2790d1e4-a292-11e7-8d23-28cfe91f7d53',
    owner_uuids: ['9ea6158e-a29a-11e7-a2c5-28cfe91f7d53'],
    nic_tag: 'internal'
}, {
    uuid: '9336f8d0-a29a-11e7-a744-28cfe91f7d53',
    nic_tag: 'interal'
}, {
    uuid: '4f854694-a35f-11e7-9574-28cfe91f7d53',
    nic_tag: 'internal'
}, {
    uuid: '3acc8d3e-a35f-11e7-8f64-28cfe91f7d53',
    owner_uuids: [ACCOUNT.uuid],
    nic_tag: 'external'
}  ];

var ACCOUNT_NETWORK = NETWORKS[0];
var OTHER_NETWORK = NETWORKS[1];
var MACHINE_UUID = '8d91185e-a28e-11e7-8b47-28cfe91f7d53';

var NICS_PATH = '/my/machines/%s/nics';
var NETWORKS_PATH = '/my/networks';
var MACHINES_PATH = '/my/machines';

var PRE_PROVISION;
var PRE_ADD_NIC;
var PRE_LIST_NETWORKS;


// --- Helpers

function clone(o) {
    return JSON.parse(JSON.stringify(o));
}


function createStubReq(method, path) {
    return {
        account: ACCOUNT,
        params: {},
        method: method,
        networks: clone(NETWORKS),
        path: function () { return path; },
        log: {
            info: function () {},
            debug: function () {}
        }
    };
}


// --- Tests

test('Setup preAddNic without cfg',
function (t) {
    try {
        plugin.preAddNic();
    } catch (e) {
        t.equal(e.message, 'cfg (object) is required', 'err message');
        t.end();
    }
});


test('Setup preAddNic with invalid cfg',
function (t) {
    try {
        plugin.preAddNic({ accounts: 'foo' });
    } catch (e) {
        t.equal(e.message, 'cfg.accounts ([uuid]) is required', 'err message');
        t.end();
    }
});


test('Setup preAddNic with valid cfg',
function (t) {
    PRE_ADD_NIC = plugin.preAddNic({ accounts: [ACCOUNT.uuid] });
    t.equal(typeof (PRE_ADD_NIC), 'function', 'func type');
    t.equal(PRE_ADD_NIC.name, 'filterOwnerAddNic', 'func name');
    t.end();
});


test('preAddNic with non-owner account',
function (t) {
    var req = createStubReq('POST', format(NICS_PATH, MACHINE_UUID));
    req.params.network = ACCOUNT_NETWORK.uuid;
    req.account = OTHER_ACCOUNT;

    PRE_ADD_NIC(req, {}, function onPreAddNic(err) {
        t.ifError(err, 'err');
        t.end();
    });
});


test('preAddNic with owner account and non-owner network',
function (t) {
    var req = createStubReq('POST', format(NICS_PATH, MACHINE_UUID));
    req.params.network = OTHER_NETWORK.uuid;

    PRE_ADD_NIC(req, {}, function onPreAddNic(err) {
        t.ok(err, 'err');
        t.equal(err.restCode, 'InvalidArgument', 'err rest code');
        t.equal(err.message,
            'Account does not have access to the specified network.',
            'err message');
        t.end();
    });
});


test('preAddNic with owner account and owner network',
function (t) {
    var req = createStubReq('POST', format(NICS_PATH, MACHINE_UUID));
    req.params.network = ACCOUNT_NETWORK.uuid;

    PRE_ADD_NIC(req, {}, function onPreAddNic(err) {
        t.ifError(err, 'err');
        t.end();
    });
});


test('preAddNic with different path',
function (t) {
    var path = format(NICS_PATH, MACHINE_UUID) + '/1a2b3c4d5e6f';
    var req = createStubReq('POST', path);
    req.params.network = ACCOUNT_NETWORK.uuid;

    PRE_ADD_NIC(req, {}, function onPreAddNic() {
        t.end();
    });
});


test('Setup preListNetworks without cfg',
function (t) {
    try {
        plugin.preListNetworks();
    } catch (e) {
        t.equal(e.message, 'cfg (object) is required', 'err message');
        t.end();
    }
});


test('Setup preListNetworks with invalid cfg',
function (t) {
    try {
        plugin.preListNetworks({ accounts: 'foo' });
    } catch (e) {
        t.equal(e.message, 'cfg.accounts ([uuid]) is required', 'err message');
        t.end();
    }
});


test('Setup preListNetworks with valid cfg',
function (t) {
    PRE_LIST_NETWORKS = plugin.preListNetworks({
        accounts: [ACCOUNT.uuid]
    });
    t.equal(typeof (PRE_LIST_NETWORKS), 'function', 'func type');
    t.equal(PRE_LIST_NETWORKS.name, 'filterOwnerListNetworks', 'func name');
    t.end();
});


test('preListNetworks with non-owner account',
function (t) {
    var req = createStubReq('GET', NETWORKS_PATH);
    req.account = OTHER_ACCOUNT;

    PRE_LIST_NETWORKS(req, {}, function onPreListNetworks(err) {
        t.ifError(err, 'err');
        t.deepEqual(req.networks, NETWORKS, 'req.networks');
        t.end();
    });
});


test('preListNetworks with owner account',
function (t) {
    var req = createStubReq('GET', NETWORKS_PATH);

    PRE_LIST_NETWORKS(req, {}, function onPreListNetworks(err) {
        t.ifError(err, 'err');
        t.deepEqual(req.networks, [
            NETWORKS[0],
            NETWORKS[4]
        ], 'req.networks');
        t.end();
    });
});


test('preListNetworks with different path',
function (t) {
    var path = NETWORKS_PATH + '/' + ACCOUNT_NETWORK.uuid;
    var req = createStubReq('GET', path);
    req.params.network = ACCOUNT_NETWORK.uuid;

    PRE_ADD_NIC(req, {}, function onPreListNetworks(err) {
        t.ifError(err, 'err');
        t.deepEqual(req.networks, NETWORKS, 'req.networks');
        t.end();
    });
});


test('Setup preProvision without cfg',
function (t) {
    try {
        plugin.preProvision();
    } catch (e) {
        t.equal(e.message, 'cfg (object) is required', 'err message');
        t.end();
    }
});


test('Setup preProvision with invalid cfg',
function (t) {
    try {
        plugin.preProvision({ accounts: 'foo' });
    } catch (e) {
        t.equal(e.message, 'cfg.accounts ([uuid]) is required', 'err message');
        t.end();
    }
});


test('Setup preProvision with valid cfg',
function (t) {
    PRE_PROVISION = plugin.preProvision({ accounts: [ACCOUNT.uuid] });
    t.equal(typeof (PRE_PROVISION), 'function');
    t.equal(PRE_PROVISION.name, 'filterOwnerProvision');
    t.end();
});


test('preProvision with non-owner account',
function (t) {
    var networks = [ACCOUNT_NETWORK.uuid];
    var req = createStubReq('POST', MACHINES_PATH);
    req.params.networks = networks;

    PRE_PROVISION(req, {}, function onPreProvision(err) {
        t.ifError(err, 'err');
        t.deepEqual(req.params.networks, networks, 'params.networks');
        t.deepEqual(req.networks, NETWORKS, 'req.networks');
        t.end();
    });
});


test('preProvision with owner account and non-owner network',
function (t) {
    var req = createStubReq('POST', MACHINES_PATH);
    req.params.networks = [OTHER_NETWORK.uuid];

    PRE_PROVISION(req, {}, function onPreProvision(err) {
        t.ok(err, 'err');
        t.equal(err.restCode, 'InvalidArgument', 'err rest code');
        t.equal(err.message, 'Account does not have access to some or all of ' +
            'the requested networks.', 'err message');
        t.end();
    });
});


test('preProvision with owner account and owner networks',
function (t) {
    var networks = [ACCOUNT_NETWORK.uuid];
    var req = createStubReq('POST', MACHINES_PATH);
    req.params.networks = networks;

    PRE_PROVISION(req, {}, function onPreProvision(err) {
        t.ifError(err, 'err');
        t.deepEqual(req.params.networks, networks, 'params.networks');
        t.deepEqual(req.networks, NETWORKS, 'req.networks');
        t.end();
    });
});


test('preProvision with owner account and non-owner package networks',
function (t) {
    var req = createStubReq('POST', MACHINES_PATH);
    req.pkg = {
        networks: [OTHER_NETWORK.uuid]
    };

    PRE_PROVISION(req, {}, function onPreProvision(err) {
        t.ok(err, 'err');
        t.equal(err.restCode, 'InvalidArgument', 'err rest code');
        t.equal(err.message, 'Account does not have access to some or all of ' +
            'the package networks.', 'err message');
        t.end();
    });
});


test('preProvision with owner account and owner package networks',
function (t) {
    var networks = [ACCOUNT_NETWORK.uuid];
    var req = createStubReq('POST', MACHINES_PATH);
    req.pkg = {
        networks: networks
    };

    PRE_PROVISION(req, {}, function onPreProvision(err) {
        t.ifError(err, 'err');
        t.deepEqual(req.networks, NETWORKS, 'req.networks');
        t.end();
    });
});


test('preProvision with owner account, package networks, non-owner networks',
function (t) {
    var req = createStubReq('POST', MACHINES_PATH);
    req.params.networks = [OTHER_NETWORK.uuid];
    req.pkg = {
        networks: [ACCOUNT_NETWORK.uuid]
    };

    PRE_PROVISION(req, {}, function onPreProvision(err) {
        t.ok(err, 'err');
        t.equal(err.restCode, 'InvalidArgument', 'err rest code');
        t.equal(err.message, 'Account does not have access to some or all of ' +
            'the requested networks.', 'err message');
        t.end();
    });
});


test('preProvision with owner account, package networks, non-owner networks',
function (t) {
    var networks = [ACCOUNT_NETWORK.uuid];
    var req = createStubReq('POST', MACHINES_PATH);
    req.params.networks = networks;
    req.pkg = {
        networks: [OTHER_NETWORK.uuid]
    };

    PRE_PROVISION(req, {}, function onPreProvision(err) {
        t.ifError(err, 'err');
        t.deepEqual(req.params.networks, networks, 'params.networks');
        t.deepEqual(req.networks, NETWORKS, 'req.networks');
        t.end();
    });
});


test('preProvision with owner account and explicit default_networks',
function (t) {
    var req = createStubReq('POST', MACHINES_PATH);
    req.params.default_networks = ['external'];

    PRE_PROVISION(req, {}, function onPreProvision(err) {
        t.ifError(err, 'err');
        t.deepEqual(req.params.networks, [NETWORKS[4].uuid], 'params.networks');
        t.deepEqual(req.networks, NETWORKS, 'req.networks');
        t.end();
    });
});


test('preProvision with owner account and implicit default_networks',
function (t) {
    var req = createStubReq('POST', MACHINES_PATH);

    PRE_PROVISION(req, {}, function onPreProvision(err) {
        t.ifError(err, 'err');
        t.deepEqual(req.params.networks, [
            NETWORKS[4].uuid,
            NETWORKS[0].uuid
        ], 'params.networks');
        t.deepEqual(req.networks, NETWORKS, 'req.networks');
        t.end();
    });
});


test('preProvision with different path',
function (t) {
    var networks = [OTHER_NETWORK.uuid];
    var req = createStubReq('POST', MACHINES_PATH + '/' + MACHINE_UUID);
    req.params.networks = networks;

    PRE_ADD_NIC(req, {}, function onPreListNetworks(err) {
        t.ifError(err, 'err');
        t.deepEqual(req.params.networks, networks, 'params.networks');
        t.deepEqual(req.networks, NETWORKS, 'req.networks');
        t.end();
    });
});
