/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Create a VM, perform a series of nic tests on it, tear VM down.
 *
 * XXX: add tests without auth
 */

var test = require('tape').test;
var util = require('util');
var vasync = require('vasync');

var common = require('./common');
var machinesCommon = require('./machines/common');
var waitForJob = machinesCommon.waitForJob;


// --- Globals


var SDC_128 = common.sdc_128_package;

var NETWORKS = [ {
    // uuid filled by createNetwork() during setup
    'name': 'test-network-alpha',
    'vlan_id': 4,
    'subnet': '10.66.60.0/24',
    'netmask': '255.255.255.0',
    'provision_start_ip': '10.66.60.10',
    'provision_end_ip': '10.66.60.240',
    'nic_tag': 'test_tag_alpha',
    'owner_uuids': [
        // added during setup
    ]
}, {
    // this network won't be added to the test machine

    // uuid filled by createNetwork() during setup
    'name': 'test-network-gamma',
    'vlan_id': 6,
    'subnet': '10.66.62.0/24',
    'netmask': '255.255.255.0',
    'provision_start_ip': '10.66.62.10',
    'provision_end_ip': '10.66.62.240',
    'nic_tag': 'test_tag_gamma',
    'owner_uuids': []
}, {
    // only added if there is no internal network on the test machine

    // uuid filled by createNetwork() during setup
    'name': 'internal',
    'vlan_id': 8,
    'subnet': '10.66.64.0/24',
    'netmask': '255.255.255.0',
    'provision_start_ip': '10.66.64.10',
    'provision_end_ip': '10.66.64.240',
    'nic_tag': 'internal',
    'owner_uuids': []
} ];

var NETWORK_POOLS = [ {
    // uuid, nic_tag, owner_uuid and networks filled in by createNetwork()
    // during setup
    'name': 'test-network-pool-alpha'
}, {
    // uuid, nic_tag, owner_uuid and networks filled in by createNetwork()
    // during setup
    'name': 'test-network-pool-gamma'
}, {
    // only added if there is no internal network on the test machine

    // uuid, nic_tag, owner_uuid and networks filled in by createNetwork()
    // during setup
    'name': 'internal'
} ];

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var IP_RE   = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
var MAC_RE  = /^(?:[0-9a-f]{2}\:){5}[0-9a-f]{2}/i;

var CLIENTS;
var CLIENT;
var CLOUDAPI_SERVER;

var MACHINE_UUID;
var OTHER_MACHINE_UUID;

var VM_NIC;
var OTHER_VM_NIC;

var OTHER_NETWORK;

var HEADNODE;
var SERVER_MAC;
var EXTERNAL_NET_RE;
var INTERNAL_NIC_TAG_EXISTS;
var LOCATION;


// --- Tests


test('setup', function (t) {
    var initClients = function (_, next) {
        common.setup('~7.2', function (err, clients, server) {
            CLIENTS = clients;
            CLIENT  = clients.user;
            CLOUDAPI_SERVER = server;

            next();
        });
    };

    var addNetwork_0 = function (_, next) {
        createNetwork(t, NETWORKS[0], NETWORK_POOLS[0], true, next);
    };

    var addNetwork_1 = function (_, next) {
        createNetwork(t, NETWORKS[1], NETWORK_POOLS[1], false, next);
    };

    var addInternalNetwork = function (_, next) {
        CLIENT.napi.listNetworks({ nic_tag: 'internal' }, function (err, nets) {
            t.ifError(err);

            if (nets.length > 0) {
                return next();
            }

            return createNetwork(t, NETWORKS[2], NETWORK_POOLS[2], false, next);
        });
    };

    var getExternalNetworkIp = function (_, next) {
        CLIENT.napi.listNetworks({ nic_tag: 'external' }, function (err, nets) {
            t.ifError(err);

            EXTERNAL_NET_RE = new RegExp('^' + nets[0].subnet.split('.').
                                        slice(0, 2).join('.'));

            next();
        });
    };

    var findHeadnode = function (_, next) {
        common.getHeadnode(CLIENT, function (err, headnode) {
            t.ifError(err);
            HEADNODE = headnode;
            next();
        });
    };

    var addServerTags = function (_, next) {
        var tags = [ NETWORKS[0].nic_tag ];

        // if we created an internal network above, we want to add to server too
        var internal = NETWORKS[2];
        if (internal.uuid) {
            tags.push(internal.nic_tag);
        }

        addTagsToServer(t, tags, HEADNODE, function (err, job) {
            t.ifError(err);

            waitForJob(CLIENT, job.job_uuid, function (err2) {
                t.ifError(err2);
                next();
            });
        });
    };

    var dataset;
    var findDataset = function (_, next) {
        CLIENT.get('/my/datasets?name=base', function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            t.ok(Array.isArray(body));

            body.forEach(function (d) {
                if (d.version && d.version === '13.4.0') {
                    dataset = d;
                }
            });

            t.ok(dataset);

            next();
        });
    };

    var createMachine = function (_, next) {
        var obj = {
            image: dataset.id,
            package: SDC_128.name,
            name: 'test-' + common.uuid(),
            server_uuid: HEADNODE.uuid,
            firewall_enabled: true
        };

        machinesCommon.createMachine(t, CLIENT, obj, function (e, machineUuid) {
            MACHINE_UUID = machineUuid;
            next();
        });
    };

    var waitTilMachineCreated = function (_, next) {
        machinesCommon.waitForRunningMachine(CLIENT, MACHINE_UUID,
                                            function (err) {
            t.ifError(err);
            next();
        });
    };

    var adminUser;
    var getAdmin = function (_, next) {
        CLIENT.ufds.getUser('admin', function (err, user) {
            t.ifError(err);

            adminUser = user;
            t.ok(adminUser);

            next();
        });
    };

    var getOtherMachine = function (_, next) {
        var args = { owner_uuid: adminUser.uuid };

        CLIENT.vmapi.listVms(args, function (err, vms) {
            t.ifError(err);

            t.ok(vms[0]);
            OTHER_MACHINE_UUID = vms[0].uuid;

            next();
        });
    };

    var getOtherNic = function (_, next) {
        CLIENT.napi.listNics({
            belongs_to_uuid: OTHER_MACHINE_UUID,
            belongs_to_type: 'zone'
        }, function (err, nics) {
            t.ifError(err);

            OTHER_VM_NIC = nics[0];
            t.ok(OTHER_VM_NIC);

            next();
        });
    };

    var getOtherNetwork = function (_, next) {
        CLIENT.napi.listNetworks({ name: 'admin' }, function (err, networks) {
            t.ifError(err);
            t.ok(Array.isArray(networks));

            OTHER_NETWORK = networks[0];
            t.ok(OTHER_NETWORK);

            next();
        });
    };

    vasync.pipeline({
        'funcs': [
            initClients, addNetwork_0, addNetwork_1, getExternalNetworkIp,
            addInternalNetwork, findHeadnode, addServerTags, findDataset,
            createMachine, waitTilMachineCreated, getAdmin, getOtherMachine,
            getOtherNic, getOtherNetwork
        ]
    }, function (err) {
        t.ifError(err);
        t.end();
    });
});


// this also checks that a VM creates with an external and internal nic by
// default if the package doesn't list networks
test('List NICs', function (t) {
    var path = '/my/machines/' + MACHINE_UUID + '/nics';

    CLIENT.get(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);

        var nics = body;

        t.ok(Array.isArray(nics));
        t.equal(nics.length, 2);

        var externalNic;
        var internalNic;

        if (nics[0].ip.match(EXTERNAL_NET_RE)) {
            externalNic = nics[0];
            internalNic = nics[1];
        } else if (nics[1].ip.match(EXTERNAL_NET_RE)) {
            externalNic = nics[1];
            internalNic = nics[0];
        } else {
            t.ok(false, 'problem with created nics');
        }

        t.ok(externalNic.mac.match(MAC_RE));
        t.ok(externalNic.netmask.match(IP_RE));
        t.ok(externalNic.gateway.match(IP_RE));
        t.equal(externalNic.primary, true);

        t.ok(internalNic.ip.match(/^10.66.64/));
        t.ok(internalNic.mac.match(MAC_RE));
        t.ok(internalNic.netmask.match(IP_RE));
        t.equal(internalNic.primary, false);

        nics.forEach(function (nic) {
            t.ifError(nic.resolvers);
            t.ifError(nic.owner_uuid);
            t.ifError(nic.network_uuid);
            t.ifError(nic.nic_tag);
            t.ifError(nic.belongs_to_type);
            t.ifError(nic.belongs_to_uuid);
            t.ifError(nic.belongs_to_type);
            t.ifError(nic.belongs_to_uuid);
        });

        VM_NIC = externalNic;

        t.end();
    });
});


test('Head NICs', function (t) {
    var path = '/my/machines/' + MACHINE_UUID + '/nics';

    CLIENT.head(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.deepEqual(body, {});
        t.end();
    });
});


test('List NICs on other machine', function (t) {
    var path = '/my/machines/' + OTHER_MACHINE_UUID + '/nics';

    var expectedErr = {
        message: 'VM not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'VM not found'
        }
    };

    getErr(t, path, expectedErr);
});


test('List NICs on nonexistent machine', function (t) {
    var path = '/my/machines/fdc3cefd-1943-4050-ba59-af5680508481/nics';

    var expectedErr = {
        message: 'VM not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'VM not found'
        }
    };

    getErr(t, path, expectedErr);
});


test('List NICs on invalid machine', function (t) {
    var path = '/my/machines/wowzers/nics';

    var expectedErr = {
        message: 'Invalid Parameters',
        statusCode: 409,
        restCode: 'ValidationFailed',
        name: 'ValidationFailedError',
        body: {
            code: 'ValidationFailed',
            message: 'Invalid Parameters',
            errors: [ {
                field: 'uuid',
                code: 'Invalid',
                message: 'Invalid UUID'
            } ]
        }
    };

    getErr(t, path, expectedErr);
});


test('Get NIC', function (t) {
    var mac = VM_NIC.mac.replace(/\:/g, '');
    var path = '/my/machines/' + MACHINE_UUID + '/nics/' + mac;

    CLIENT.get(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);

        t.deepEqual(VM_NIC, body);

        t.end();
    });
});


test('Head NIC', function (t) {
    var mac = VM_NIC.mac.replace(/\:/g, '');
    var path = '/my/machines/' + MACHINE_UUID + '/nics/' + mac;

    CLIENT.head(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.deepEqual(body, {});
        t.end();
    });
});


test('Get nonexistent NIC', function (t) {
    var path = '/my/machines/' + MACHINE_UUID + '/nics/baadd34db33f';

    // the err message must match the 'Get non-owner NIC from owner machine'
    // test below
    var expectedErr = {
        message: 'nic not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'nic not found'
        }
    };

    getErr(t, path, expectedErr);
});


test('Get invalid NIC', function (t) {
    var path = '/my/machines/' + MACHINE_UUID + '/nics/wowzers';

    var expectedErr = {
        message: 'mac has invalid format',
        statusCode: 409,
        restCode: 'InvalidArgument',
        name: 'InvalidArgumentError',
        body: {
            code: 'InvalidArgument',
            message: 'mac has invalid format'
        }
    };

    getErr(t, path, expectedErr);
});


test('Get NIC from invalid machine', function (t) {
    var mac = VM_NIC.mac.replace(/\:/g, '');
    var path = '/my/machines/wowzers/nics/' + mac;

    var expectedErr = {
        message: 'Invalid Parameters',
        statusCode: 409,
        restCode: 'ValidationFailed',
        name: 'ValidationFailedError',
        body: {
            code: 'ValidationFailed',
            message: 'Invalid Parameters',
            errors: [ {
                field: 'uuid',
                code: 'Invalid',
                message: 'Invalid UUID'
            } ]
        }
    };

    getErr(t, path, expectedErr);
});


test('Get owner NIC from non-owner machine', function (t) {
    var mac = VM_NIC.mac.replace(/\:/g, '');
    var path = '/my/machines/' + OTHER_MACHINE_UUID + '/nics/' + mac;

    var expectedErr = {
        message: 'VM not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'VM not found'
        }
    };

    getErr(t, path, expectedErr);
});


test('Get non-owner NIC from owner machine', function (t) {
    var mac = OTHER_VM_NIC.mac.replace(/\:/g, '');
    var path = '/my/machines/' + MACHINE_UUID + '/nics/' + mac;

    // the err message must match the 'Get nonexistent NIC' test above
    var expectedErr = {
        message: 'nic not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'nic not found'
        }
    };

    getErr(t, path, expectedErr);
});


test('Get non-owner NIC from non-owner machine', function (t) {
    var mac = OTHER_VM_NIC.mac.replace(/\:/g, '');
    var path = '/my/machines/' + OTHER_MACHINE_UUID + '/nics/' + mac;

    var expectedErr = {
        message: 'VM not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'VM not found'
        }
    };

    getErr(t, path, expectedErr);
});


test('Get NIC from nonexistent machine', function (t) {
    var mac = VM_NIC.mac.replace(/\:/g, '');
    var path = '/my/machines/fa9e18e4-654a-43a8-918b-cce04bdbf461/nics/' + mac;

    var expectedErr = {
        message: 'VM not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'VM not found'
        }
    };

    getErr(t, path, expectedErr);
});


// NB: changes value of VM_NIC global
test('Create NIC using network', function (t) {
    var path = '/my/machines/' + MACHINE_UUID + '/nics';
    var args = { network: NETWORKS[0].uuid };

    CLIENT.post(path, args, function (err, req, res, nic) {
        t.ifError(err);
        t.equal(res.statusCode, 201);

        t.ok(nic.mac.match(MAC_RE));
        t.ok(nic.ip.match(IP_RE));
        t.equal(nic.primary, false);
        t.equal(nic.state, 'provisioning');

        var nicFront = nic.ip.split('.').slice(0, 3).join('.');
        var netFront = NETWORKS[0].subnet.split('.').slice(0, 3).join('.');
        t.equal(nicFront, netFront);

        t.ifError(nic.gateway);
        t.ifError(nic.resolvers);
        t.ifError(nic.owner_uuid);
        t.ifError(nic.network_uuid);
        t.ifError(nic.nic_tag);
        t.ifError(nic.belongs_to_type);
        t.ifError(nic.belongs_to_uuid);


        LOCATION = res.headers.location;
        t.ok(LOCATION);

        CLIENT.get(LOCATION, function (err2, req2, res2, nic2) {
            t.ifError(err2);
            t.equal(res2.statusCode, 200);

            t.deepEqual(nic, nic2);
            VM_NIC = nic;

            t.end();
        });
    });
});


test('Wait til network NIC added', function (t) {
    waitTilNicAdded(t, LOCATION);
});


test('Create non-owner network on owner machine', function (t) {
    var path = '/my/machines/' + MACHINE_UUID + '/nics';
    var args = { network: OTHER_NETWORK.uuid };

    var expectedErr = {
        message: 'owner cannot provision on network',
        statusCode: 403,
        restCode: 'NotAuthorized',
        name: 'NotAuthorizedError',
        body: {
            code: 'NotAuthorized',
            message: 'owner cannot provision on network'
        }
    };

    postErr(t, path, args, expectedErr);
});


test('Create owner network on non-owner machine', function (t) {
    var path = '/my/machines/' + OTHER_MACHINE_UUID + '/nics';
    var args = { network: NETWORKS[0].uuid };

    var expectedErr = {
        message: 'VM not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'VM not found'
        }
    };

    postErr(t, path, args, expectedErr);
});


test('Create non-owner network on non-owner machine', function (t) {
    var path = '/my/machines/' + OTHER_MACHINE_UUID + '/nics';
    var args = { network: OTHER_NETWORK.uuid };

    var expectedErr = {
        message: 'VM not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'VM not found'
        }
    };

    postErr(t, path, args, expectedErr);
});


test('Create NIC on server missing nic tag', function (t) {
    var path = '/my/machines/' + MACHINE_UUID + '/nics';
    var args = { network: NETWORKS[1].uuid };  // NB: 1, not 0

    var expectedErr = {
        message: 'Server does not support that network',
        statusCode: 409,
        restCode: 'InvalidArgument',
        name: 'InvalidArgumentError',
        body: {
            code: 'InvalidArgument',
            message: 'Server does not support that network'
        }
    };

    postErr(t, path, args, expectedErr);
});


test('Create NIC with pool on server missing nic tag', function (t) {
    var path = '/my/machines/' + MACHINE_UUID + '/nics';
    var args = { network: NETWORK_POOLS[1].uuid };

    var expectedErr = {
        message: 'Server does not support that network',
        statusCode: 409,
        restCode: 'InvalidArgument',
        name: 'InvalidArgumentError',
        body: {
            code: 'InvalidArgument',
            message: 'Server does not support that network'
        }
    };

    postErr(t, path, args, expectedErr);
});


test('Create with invalid network', function (t) {
    var path = '/my/machines/' + MACHINE_UUID + '/nics';
    var args = { network: 'wowzers' };

    var expectedErr = {
        message: 'network argument has invalid format',
        statusCode: 409,
        restCode: 'InvalidArgument',
        name: 'InvalidArgumentError',
        body: {
            code: 'InvalidArgument',
            message: 'network argument has invalid format'
        }
    };

    postErr(t, path, args, expectedErr);
});


test('Create with invalid machine', function (t) {
    var path = '/my/machines/wowzers/nics';
    var args = { network: NETWORKS[0].uuid };

    var expectedErr = {
        message: 'Invalid Parameters',
        statusCode: 409,
        restCode: 'ValidationFailed',
        name: 'ValidationFailedError',
        body: {
            code: 'ValidationFailed',
            message: 'Invalid Parameters',
            errors: [ {
                field: 'uuid',
                code: 'Invalid',
                message: 'Invalid UUID'
            } ]
        }
    };

    postErr(t, path, args, expectedErr);
});


test('Create with nonexistent network', function (t) {
    var path = '/my/machines/' + MACHINE_UUID + '/nics';
    var args = { network: '05cab1d4-f816-41c0-b45f-a4ffeda5a6b5' };

    var expectedErr = {
        message: 'network not found',
        statusCode: 409,
        restCode: 'InvalidArgument',
        name: 'InvalidArgumentError',
        body: {
            code: 'InvalidArgument',
            message: 'network not found'
        }
    };

    postErr(t, path, args, expectedErr);
});


test('Create with nonexistent machine', function (t) {
    var path = '/my/machines/aa26a3ee-e3d4-4e7e-a087-678ca877a338/nics';
    var args = { network: NETWORKS[0].uuid };

    var expectedErr = {
        message: 'VM not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'VM not found'
        }
    };

    postErr(t, path, args, expectedErr);
});


test('Remove owner NIC from non-owner machine', function (t) {
    var mac  = VM_NIC.mac.replace(/\:/g, '');
    var path = '/my/machines/' + OTHER_MACHINE_UUID + '/nics/' + mac;

    var expectedErr = {
        message: 'VM not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'VM not found'
        }
    };

    delErr(t, path, expectedErr);
});


test('Remove non-owner NIC from owner machine', function (t) {
    var mac  = OTHER_VM_NIC.mac.replace(/\:/g, '');
    var path = '/my/machines/' + MACHINE_UUID + '/nics/' + mac;

    var expectedErr = {
        message: 'nic not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'nic not found'
        }
    };

    delErr(t, path, expectedErr);
});


test('Remove non-owner NIC from non-owner machine', function (t) {
    var mac  = OTHER_VM_NIC.mac.replace(/\:/g, '');
    var path = '/my/machines/' + OTHER_MACHINE_UUID + '/nics/' + mac;

    var expectedErr = {
        message: 'VM not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'VM not found'
        }
    };

    delErr(t, path, expectedErr);
});



test('Remove invalid NIC', function (t) {
    var path = '/my/machines/' + MACHINE_UUID + '/nics/wowzers';

    var expectedErr = {
        message: 'mac has invalid format',
        statusCode: 409,
        restCode: 'InvalidArgument',
        name: 'InvalidArgumentError',
        body: {
            code: 'InvalidArgument',
            message: 'mac has invalid format'
        }
    };

    delErr(t, path, expectedErr);
});



test('Remove NIC from invalid machine', function (t) {
    var mac  = VM_NIC.mac.replace(/\:/g, '');
    var path = '/my/machines/wowzers/nics/' + mac;

    var expectedErr = {
        message: 'Invalid Parameters',
        statusCode: 409,
        restCode: 'ValidationFailed',
        name: 'ValidationFailedError',
        body: {
            code: 'ValidationFailed',
            message: 'Invalid Parameters',
            errors: [ {
                field: 'uuid',
                code: 'Invalid',
                message: 'Invalid UUID'
            } ]
        }
    };

    delErr(t, path, expectedErr);
});



test('Remove nonexistent NIC', function (t) {
    var path = '/my/machines/' + MACHINE_UUID + '/nics/012345678901';

    var expectedErr = {
        message: 'nic not found',
        statusCode: 404,
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'nic not found'
        }
    };

    delErr(t, path, expectedErr);
});



test('Remove NIC using network', function (t) {
    removeNic(t, VM_NIC);
});



test('Wait til network NIC removed', waitTilNicDeleted);



// NB: changes value of VM_NIC global
test('Create NIC using network pool', function (t) {
    var path = '/my/machines/' + MACHINE_UUID + '/nics';
    var args = { network: NETWORK_POOLS[0].uuid };

    CLIENT.post(path, args, function (err, req, res, nic) {
        t.ifError(err);
        t.equal(res.statusCode, 201);

        t.ok(nic.mac.match(MAC_RE));
        t.ok(nic.ip.match(IP_RE));
        t.equal(nic.primary, false);
        t.equal(nic.state, 'provisioning');

        t.ifError(nic.gateway);
        t.ifError(nic.resolvers);
        t.ifError(nic.owner_uuid);
        t.ifError(nic.network_uuid);
        t.ifError(nic.nic_tag);
        t.ifError(nic.belongs_to_type);
        t.ifError(nic.belongs_to_uuid);

        LOCATION = res.headers.location;
        t.ok(LOCATION);

        CLIENT.get(LOCATION, function (err2, req2, res2, nic2) {
            t.ifError(err2);
            t.equal(res2.statusCode, 200);

            t.deepEqual(nic, nic2);
            VM_NIC = nic;

            t.end();
        });
    });
});



test('Wait til network pool NIC added', function (t) {
    waitTilNicAdded(t, LOCATION);
});



test('Remove NIC using network pool', function (t) {
    removeNic(t, VM_NIC);
});



test('Wait til network pool NIC removed', waitTilNicDeleted);



test('teardown', function (t) {
    var deleteMachine = function (_, next) {
        CLIENT.del('/my/machines/' + MACHINE_UUID, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            next();
        });
    };

    var waitTilMachineDeleted = function (_, next) {
        CLIENT.vmapi.listJobs({
            vm_uuid: MACHINE_UUID,
            task: 'destroy'
        }, function (err, jobs) {
            t.ifError(err);
            t.ok(Array.isArray(jobs));

            var job = jobs[0];
            t.ok(job);

            waitForJob(CLIENT, job.uuid, function (err2) {
                t.ifError(err2);
                next();
            });
        });
    };

    var removeServerTags = function (_, next) {
        var tags = [ NETWORKS[0].nic_tag ];

        // if we added an internal network for testing, we want to remove the
        // tag from the server now
        if (NETWORKS[2].uuid) {
            tags.push(NETWORKS[2].nic_tag);
        }

        removeTagsFromServer(t, tags, HEADNODE, function (err, job) {
            t.ifError(err);

            waitForJob(CLIENT, job.job_uuid, function (err2) {
                t.ifError(err2);
                next();
            });
        });
    };

    var removeNetwork_0 = function (_, next) {
        removeNetwork(t, NETWORKS[0], NETWORK_POOLS[0], next);
    };

    var removeNetwork_1 = function (_, next) {
        removeNetwork(t, NETWORKS[1], NETWORK_POOLS[1], next);
    };

    var removeInternalNetwork = function (_, next) {
        var internal = NETWORKS[2];

        if (internal.uuid) {
            removeNetwork(t, internal, NETWORK_POOLS[2], next);
        } else {
            next();
        }
    };

    var teardown = function (_, next) {
        common.teardown(CLIENTS, CLOUDAPI_SERVER, next);
    };


    vasync.pipeline({
        'funcs': [
            deleteMachine, waitTilMachineDeleted, removeServerTags,
            removeNetwork_0, removeNetwork_1, removeInternalNetwork,
            teardown
        ]
    }, function (err) {
        t.ifError(err);
        t.end();
    });
});


// --- Helpers


function createNetwork(t, net, pool, addOwner, callback) {
    CLIENT.napi.createNicTag(net.nic_tag, function (err) {
        // gross hack to work around internal nic tag sometimes existing when
        // internal network doesn't
        if (err && net.nic_tag === 'internal') {
            INTERNAL_NIC_TAG_EXISTS = true;
        } else {
            t.ifError(err, 'creating nic tag ' + net.nic_tag);
        }

        pool.nic_tag = net.nic_tag;

        if (addOwner) {
            // Fill in owner_uuids entries in NETWORKS and NETWORK_POOLS globals
            net.owner_uuids.push(CLIENT.account.uuid);
            pool.owner_uuids = net.owner_uuids;
        }

        CLIENT.napi.createNetwork(net, function (err2, _net) {
            t.ifError(err2, 'creating network ' + net.name);

            // Fill in uuid entries in NETWORKS global
            net.uuid = _net.uuid;

            // Fill in networks entries in NETWORK_POOLS global
            pool.networks = [net.uuid];

            var name = pool.name;
            CLIENT.napi.createNetworkPool(name, pool, function (err3, _pool) {
                t.ifError(err3, 'creating network pool ' + name);

                // Fill in uuid entries in NETWORK_POOLS global
                pool.uuid = _pool.uuid;

                callback();
            });
        });
    });
}


function removeNetwork(t, net, pool, callback) {
    CLIENT.napi.deleteNetworkPool(pool.uuid, function (err) {
        t.ifError(err);

        CLIENT.napi.deleteNetwork(net.uuid, function (err2) {
            t.ifError(err2);

            if (net.nic_tag === 'internal' && INTERNAL_NIC_TAG_EXISTS) {
                return callback();
            }

            return CLIENT.napi.deleteNicTag(net.nic_tag, function (err3) {
                t.ifError(err3);
                callback();
            });
        });
    });
}


function addTagsToServer(t, nicTags, server, callback) {
    var ifaces = server.sysinfo['Network Interfaces'];

    var nic = Object.keys(ifaces).map(function (iname) {
        return ifaces[iname];
    }).filter(function (iface) {
        return iface['NIC Names'].indexOf('external') !== -1;
    })[0];

    SERVER_MAC = nic['MAC Address'];

    var args = {
        action: 'update',
        nics: [ {
            mac: SERVER_MAC,
            nic_tags_provided: nicTags
        } ]
    };

    CLIENT.cnapi.updateNics(server.uuid, args, function (err, res) {
        t.ifError(err);
        callback(null, res);
    });
}


function removeTagsFromServer(t, nicTags, server, callback) {
    var args = {
        action: 'delete',
        nics: [ {
            mac: SERVER_MAC,
            nic_tags_provided: nicTags
        } ]
    };

    CLIENT.cnapi.updateNics(server.uuid, args, function (err, res) {
        t.ifError(err);
        callback(null, res);
    });
}


function getErr(t, path, expectedErr) {
    CLIENT.get(path, function (err, req, res, body) {
        t.equal(res.statusCode, expectedErr.statusCode);
        t.deepEqual(err, expectedErr);
        t.deepEqual(body, expectedErr.body);

        t.end();
    });
}


function postErr(t, path, args, expectedErr) {
    verifyUnchangedNics(t, function (next) {
        CLIENT.post(path, args, function (err, req, res, body) {
            t.equal(res.statusCode, expectedErr.statusCode);
            t.deepEqual(err, expectedErr);
            t.deepEqual(body, expectedErr.body);

            next();
        });
    });
}


function delErr(t, path, expectedErr) {
    verifyUnchangedNics(t, function (next) {
        CLIENT.del(path, function (err, req, res, body) {
            t.equal(res.statusCode, expectedErr.statusCode);
            t.deepEqual(err, expectedErr);
            t.deepEqual(body, expectedErr.body);

            next();
        });
    });
}


function verifyUnchangedNics(t, mutator) {
    CLIENT.napi.listNics({
        belongs_to_type: 'zone'
    }, function (err, origNics) {
        t.ifError(err);

        t.ok(origNics.length > 0);

        mutator(function () {
            // check nics didn't change
            CLIENT.napi.listNics({
                belongs_to_type: 'zone'
            }, function (err2, newNics) {
                t.ifError(err2);
                t.deepEqual(sortNics(origNics), sortNics(newNics));
                t.end();
            });
        });
    });
}


function sortNics(nics) {
    return nics.sort(function (a, b) {
        return (a.mac > b.mac) ? 1 : -1;
    });
}


function waitTilNicAdded(t, path) {
    var count = 30;

    function check() {
        count--;
        if (count === 0) {
            t.ifError(true, 'NIC did not provision in time');
            return t.end();
        }

        return CLIENT.get(path, function (err, req, res, nic) {
            t.ifError(err);

            if (nic.state === 'running') {
                return t.end();
            } else {
                return setTimeout(check, 5000);
            }
        });
    }

    check();
}


function removeNic(t, nic) {
    var mac  = nic.mac.replace(/\:/g, '');
    var path = '/my/machines/' + MACHINE_UUID + '/nics/' + mac;

    CLIENT.del(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        t.deepEqual(body, {});

        LOCATION = path;
        t.end();
    });
}


// depends on LOCATION global set by removeNic() above
function waitTilNicDeleted(t) {
    var count = 30;

    function check() {
        count--;
        if (count === 0) {
            t.ifError(true, 'NIC did not delete in time');
            return t.end();
        }

        return CLIENT.get(LOCATION, function (err, req, res, nic) {
            if (err) {
                t.equal(err.statusCode, 404);
                return t.end();
            } else {
                return setTimeout(check, 5000);
            }
        });
    }

    check();
}
