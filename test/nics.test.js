/*
 * Copyright 2014 Joyent, Inc. All rights reserved.
 *
 * Create a VM, perform a series of nic tests on it, tear VM down.
 *
 * XXX: add tests without auth
 */



var fs = require('fs');
var libuuid = require('libuuid');
var test = require('tap').test;
var util = require('util');
var vasync = require('vasync');

var common = require('./common');
var machinesCommon = require('./machines/common');



// --- Globals



var KEY_NAME = '818da7ae-b4f4-46a5-a51d-c1cea0bb24ed';

var KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEAvad19ePSDckmgmo6Unqmd8' +
    'n2G7o1794VN3FazVhV09yooXIuUhA+7OmT7ChiHueayxSubgL2MrO/HvvF/GGVUs/t3e0u4' +
    '5YwRC51EVhyDuqthVJWjKrYxgDMbHru8fc1oV51l0bKdmvmJWbA/VyeJvstoX+eiSGT3Jge' +
    'egSMVtc= mark@foo.local';

var META_CREDS = {
    'root': 'secret',
    'admin': 'secret'
};

var TAP_CONF = {
    timeout: 'Infinity '
};

var PACKAGE = {
    uuid: '897779dc-9ce7-4042-8879-a4adccc94353',
    name: 'sdc_128_ok',
    version: '1.0.0',
    max_physical_memory: 128,
    quota: 10240,
    max_swap: 512,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    fss: 25,
    'default': false,
    vcpus: 1,
    urn: 'sdc:897779dc-9ce7-4042-8879-a4adccc94353:sdc_128_ok:1.0.0',
    active: true
};

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
    'owner_uuids': [
        // added during setup
    ]
} ];

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var IP_RE   = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
var MAC_RE  = /^(?:[0-9a-f]{2}\:){5}[0-9a-f]{2}/i;



var client, cnapiServer, machineUuid, headnode, vmNic, serverMac, adminUser,
    otherMachineUuid, otherVmNic, otherNetwork;



// --- Tests



test('setup', TAP_CONF, function (t) {
    var setup = function (_, next) {
        common.setup('~7.1', function (err, _client, _server) {
            t.ifError(err);

            t.ok(_client);
            client = _client;

            t.ok(_server);
            cnapiServer = _server;

            next();
        });
    };

    var addKey = function (_, next) {
        // callee does its own assertions
        machinesCommon.saveKey(KEY, KEY_NAME, client, t, next);
    };

    var addPackage = function (_, next) {
        machinesCommon.addPackage(client, PACKAGE, function (err, entry) {
            t.ifError(err);
            next();
        });
    };

    var addNetwork_0 = function (_, next) {
        createNetwork(t, NETWORKS[0], true, next);
    };

    var addNetwork_1 = function (_, next) {
        createNetwork(t, NETWORKS[1], false, next);
    };

    var findHeadnode = function (_, next) {
        var args = { extras: 'sysinfo' };

        client.cnapi.listServers(args, function (err, servers) {
            t.ifError(err);
            t.ok(Array.isArray(servers));

            servers = servers.filter(function (s) { return s.headnode; });

            headnode = servers[0];
            t.ok(headnode);

            next();
        });
    };

    var addServerTags = function (_, next) {
        var tags = [ NETWORKS[0].nic_tag ];

        addTagsToServer(t, tags, headnode, function (err, job) {
            t.ifError(err);

            machinesCommon.waitForJob(client, job.job_uuid, function (err2) {
                t.ifError(err2);
                next();
            });
        });
    };

    var dataset;
    var findDataset = function (_, next) {
        client.get('/my/datasets?name=base', function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            t.ok(Array.isArray(body));

            dataset = body[0];
            t.ok(dataset);

            next();
        });
    };

    var createMachine = function (_, next) {
        var obj = {
            image: dataset.id,
            package: PACKAGE.name,
            name: 'test-' + libuuid.create(),
            server_uuid: headnode.uuid,
            firewall_enabled: true,
            'tag.role': 'unitTest',
            'metadata.credentials': META_CREDS
        };

        client.post('/my/machines', obj, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 201);

            machineUuid = body.id;
            t.ok(machineUuid);

            next();
        });
    };

    var waitTilMachineCreated = function (_, next) {
        client.vmapi.listJobs({
            vm_uuid: machineUuid,
            task: 'provision'
        }, function (err, jobs) {
            t.ifError(err);
            t.ok(Array.isArray(jobs));

            var job = jobs[0];
            t.ok(job);

            machinesCommon.waitForJob(client, job.uuid, function (err2) {
                t.ifError(err2);
                next();
            });
        });
    };

    var getAdmin = function (_, next) {
        client.ufds.getUser('admin', function (err, user) {
            t.ifError(err);

            adminUser = user;
            t.ok(adminUser);

            next();
        });
    };

    var getOtherMachine = function (_, next) {
        var args = { owner_uuid: adminUser.uuid };

        client.vmapi.listVms(args, function (err, vms) {
            t.ifError(err);

            t.ok(vms[0]);
            otherMachineUuid = vms[0].uuid;

            next();
        });
    };

    var getOtherNic = function (_, next) {
        client.napi.listNics({
            belongs_to_uuid: otherMachineUuid,
            belongs_to_type: 'zone'
        }, function (err, nics) {
            t.ifError(err);

            otherVmNic = nics[0];
            t.ok(otherVmNic);

            next();
        });
    };

    var getOtherNetwork = function (_, next) {
        client.napi.listNetworks({ name: 'admin' }, function (err, networks) {
            t.ifError(err);
            t.ok(Array.isArray(networks));

            otherNetwork = networks[0];
            t.ok(otherNetwork);

            next();
        });
    };

    vasync.pipeline({
        'funcs': [
            setup, addKey, addPackage, addNetwork_0, addNetwork_1, findHeadnode,
            addServerTags, findDataset, createMachine, waitTilMachineCreated,
            getAdmin, getOtherMachine, getOtherNic, getOtherNetwork
        ]
    }, function (err) {
        t.ifError(err);
        t.end();
    });
});



test('List NICs', TAP_CONF, function (t) {
    var path = '/my/machines/' + machineUuid + '/nics';

    client.get(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);

        t.ok(Array.isArray(body));
        t.equal(body.length, 1);

        vmNic = body[0];
        t.ok(vmNic.mac.match(MAC_RE));
        t.equal(vmNic.owner_uuid, client.account.uuid);
        t.equal(vmNic.primary, true);
        t.ok(vmNic.ip.match(IP_RE));
        t.ok(vmNic.gateway.match(IP_RE));
        t.ok(typeof (vmNic.vlan_id) === 'number');
        t.equal(vmNic.nic_tag, 'external');
        t.ok(vmNic.network_uuid.match(UUID_RE));

        t.ok(Array.isArray(vmNic.resolvers));
        vmNic.resolvers.forEach(function (resolver) {
            t.ok(resolver.match(IP_RE));
        });

        t.ifError(vmNic.belongs_to_type);
        t.ifError(vmNic.belongs_to_uuid);

        t.end();
    });
});



test('Head NICs', TAP_CONF, function (t) {
    var path = '/my/machines/' + machineUuid + '/nics';

    client.head(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.equivalent(body, {});
        t.end();
    });
});



test('List NICs on other machine', TAP_CONF, function (t) {
    var path = '/my/machines/' + otherMachineUuid + '/nics';

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



test('List NICs on nonexistent machine', TAP_CONF, function (t) {
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



test('List NICs on invalid machine', TAP_CONF, function (t) {
    var path = '/my/machines/wowzers/nics';

    var expectedErr = {
        message: 'VM has invalid format',
        statusCode: 409,
        restCode: 'InvalidArgument',
        name: 'InvalidArgumentError',
        body: {
            code: 'InvalidArgument',
            message: 'VM has invalid format'
        }
    };

    getErr(t, path, expectedErr);
});



test('Get NIC', TAP_CONF, function (t) {
    var mac = vmNic.mac.replace(/\:/g, '');
    var path = '/my/machines/' + machineUuid + '/nics/' + mac;

    client.get(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);

        t.equivalent(vmNic, body);

        t.end();
    });
});



test('Head NIC', TAP_CONF, function (t) {
    var mac = vmNic.mac.replace(/\:/g, '');
    var path = '/my/machines/' + machineUuid + '/nics/' + mac;

    client.head(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.equivalent(body, {});
        t.end();
    });
});



test('Get nonexistent NIC', TAP_CONF, function (t) {
    var path = '/my/machines/' + machineUuid + '/nics/baadd34db33f';

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



test('Get invalid NIC', TAP_CONF, function (t) {
    var path = '/my/machines/' + machineUuid + '/nics/wowzers';

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



test('Get NIC from invalid machine', TAP_CONF, function (t) {
    var mac = vmNic.mac.replace(/\:/g, '');
    var path = '/my/machines/wowzers/nics/' + mac;

    var expectedErr = {
        message: 'VM has invalid format',
        statusCode: 409,
        restCode: 'InvalidArgument',
        name: 'InvalidArgumentError',
        body: {
            code: 'InvalidArgument',
            message: 'VM has invalid format'
        }
    };

    getErr(t, path, expectedErr);
});



test('Get owner NIC from non-owner machine', TAP_CONF, function (t) {
    var mac = vmNic.mac.replace(/\:/g, '');
    var path = '/my/machines/' + otherMachineUuid + '/nics/' + mac;

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



test('Get non-owner NIC from owner machine', TAP_CONF, function (t) {
    var mac = otherVmNic.mac.replace(/\:/g, '');
    var path = '/my/machines/' + machineUuid + '/nics/' + mac;

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



test('Get non-owner NIC from non-owner machine', TAP_CONF, function (t) {
    var mac = otherVmNic.mac.replace(/\:/g, '');
    var path = '/my/machines/' + otherMachineUuid + '/nics/' + mac;

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



test('Get NIC from nonexistent machine', TAP_CONF, function (t) {
    var mac = vmNic.mac.replace(/\:/g, '');
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



// NB: changes value of vmNic global
test('Create NIC', TAP_CONF, function (t) {
    var path = '/my/machines/' + machineUuid + '/nics';
    var args = { network: NETWORKS[0].uuid };

    client.post(path, args, function (err, req, res, nic) {
        t.ifError(err);
        t.equal(res.statusCode, 201);

        t.ok(nic.mac.match(MAC_RE));
        t.ok(nic.ip.match(IP_RE));

        var nicFront = nic.ip.split('.').slice(0, 3).join('.');
        var netFront = NETWORKS[0].subnet.split('.').slice(0, 3).join('.');
        t.equal(nicFront, netFront);

        t.equal(nic.owner_uuid, client.account.uuid);
        t.equal(nic.primary, false);
        t.equal(nic.vlan_id, NETWORKS[0].vlan_id);
        t.equal(nic.nic_tag, NETWORKS[0].nic_tag);
        t.equal(nic.network_uuid, NETWORKS[0].uuid);
        t.equivalent(nic.resolvers, []);

        t.ifError(nic.gateway);
        t.ifError(nic.belongs_to_type);
        t.ifError(nic.belongs_to_uuid);

        var location = res.headers.location;
        t.ok(location);

        client.get(location, function (err2, req2, res2, nic2) {
            t.ifError(err2);
            t.equal(res2.statusCode, 200);

            t.equivalent(nic, nic2);
            vmNic = nic;

            t.end();
        });
    });
});



test('Create non-owner network on owner machine', TAP_CONF, function (t) {
    var path = '/my/machines/' + machineUuid + '/nics';
    var args = { network: otherNetwork.uuid };

    var expectedErr = {
        message: 'Owner cannot provision on network',
        statusCode: 403,
        restCode: 'NotAuthorized',
        name: 'NotAuthorizedError',
        body: {
            code: 'NotAuthorized',
            message: 'Owner cannot provision on network'
        }
    };

    postErr(t, path, args, expectedErr);
});



test('Create owner network on non-owner machine', TAP_CONF, function (t) {
    var path = '/my/machines/' + otherMachineUuid + '/nics';
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



test('Create non-owner network on non-owner machine', TAP_CONF, function (t) {
    var path = '/my/machines/' + otherMachineUuid + '/nics';
    var args = { network: otherNetwork.uuid };

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



test('Create NIC on server missing nic tag', TAP_CONF, function (t) {
    var path = '/my/machines/' + machineUuid + '/nics';
    var args = { network: NETWORKS[1].uuid };  // NB: 1, not 0

    var expectedErr = {
        message: 'Server does not have NIC tag: test_tag_gamma',
        statusCode: 500,
        restCode: 'InternalError',
        name: 'InternalError',
        body: {
            code: 'InternalError',
            message: 'Server does not have NIC tag: test_tag_gamma'
        }
    };

    postErr(t, path, args, expectedErr);
});



test('Create with invalid network', TAP_CONF, function (t) {
    var path = '/my/machines/' + machineUuid + '/nics';
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



test('Create with invalid machine', TAP_CONF, function (t) {
    var path = '/my/machines/wowzers/nics';
    var args = { network: NETWORKS[0].uuid };

    var expectedErr = {
        message: 'VM has invalid format',
        statusCode: 409,
        restCode: 'InvalidArgument',
        name: 'InvalidArgumentError',
        body: {
            code: 'InvalidArgument',
            message: 'VM has invalid format'
        }
    };

    postErr(t, path, args, expectedErr);
});



test('Create with nonexistent network', TAP_CONF, function (t) {
    var path = '/my/machines/' + machineUuid + '/nics';
    var args = { network: '05cab1d4-f816-41c0-b45f-a4ffeda5a6b5' };

    var expectedErr = {
        message: 'network not found',
        statusCode: 404,      // XXX should be 409
        restCode: 'ResourceNotFound',
        name: 'ResourceNotFoundError',
        body: {
            code: 'ResourceNotFound',
            message: 'network not found'
        }
    };

    postErr(t, path, args, expectedErr);
});



test('Create with nonexistent machine', TAP_CONF, function (t) {
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



test('Remove owner NIC from non-owner machine', TAP_CONF, function (t) {
    var mac  = vmNic.mac.replace(/\:/g, '');
    var path = '/my/machines/' + otherMachineUuid + '/nics/' + mac;

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



test('Remove non-owner NIC from owner machine', TAP_CONF, function (t) {
    var mac  = otherVmNic.mac.replace(/\:/g, '');
    var path = '/my/machines/' + machineUuid + '/nics/' + mac;

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



test('Remove non-owner NIC from non-owner machine', TAP_CONF, function (t) {
    var mac  = otherVmNic.mac.replace(/\:/g, '');
    var path = '/my/machines/' + otherMachineUuid + '/nics/' + mac;

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



test('Remove invalid NIC', TAP_CONF, function (t) {
    var path = '/my/machines/' + machineUuid + '/nics/wowzers';

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



test('Remove NIC from invalid machine', TAP_CONF, function (t) {
    var mac  = vmNic.mac.replace(/\:/g, '');
    var path = '/my/machines/wowzers/nics/' + mac;

    var expectedErr = {
        message: 'VM has invalid format',
        statusCode: 409,
        restCode: 'InvalidArgument',
        name: 'InvalidArgumentError',
        body: {
            code: 'InvalidArgument',
            message: 'VM has invalid format'
        }
    };

    delErr(t, path, expectedErr);
});



test('Remove nonexistent NIC', TAP_CONF, function (t) {
    var path = '/my/machines/' + machineUuid + '/nics/012345678901';

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



test('Remove NIC', TAP_CONF, function (t) {
    var mac  = vmNic.mac.replace(/\:/g, '');
    var path = '/my/machines/' + machineUuid + '/nics/' + mac;

    client.del(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        t.equivalent(body, {});

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

        // check it's gone
        getErr(t, path, expectedErr);
    });
});



test('teardown', TAP_CONF, function (t) {
    var deleteMachine = function (_, next) {
        client.del('/my/machines/' + machineUuid, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            next();
        });
    };

    var removeServerTags = function (_, next) {
        var tags = [ NETWORKS[0].nic_tag ];
        removeTagsFromServer(t, tags, headnode, next);
    };

    var removeNetwork_0 = function (_, next) {
        removeNetwork(t, NETWORKS[0], next);
    };

    var removeNetwork_1 = function (_, next) {
        removeNetwork(t, NETWORKS[1], next);
    };

    var removeKey = function (_, next) {
        client.del('/my/keys/' + KEY_NAME, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            next();
        });
    };

    var teardown = function (_, next) {
        client.teardown(function (err) {
            // Ignore err here, just means we have not been able to remove
            // something from ufds.

            if (process.env.SDC_SETUP_TESTS) {
                return next();
            }

            Object.keys(cnapiServer._clients).forEach(function (c) {
                var cli = cnapiServer._clients[c].client;

                if (cli && cli.close) {
                    cli.close();
                }
            });

            cnapiServer._clients.ufds.client.removeAllListeners('close');

            cnapiServer.close(next);

            return null; // keep lint happy
        });
    };


    vasync.pipeline({
        'funcs': [
            deleteMachine, removeServerTags, removeNetwork_0, removeNetwork_1,
            removeKey, teardown
        ]
    }, function (err) {
        t.ifError(err);
        t.end();
    });
});



// --- Helpers:



function createNetwork(t, net, addOwner, callback) {
    client.napi.createNicTag(net.nic_tag, function (err) {
        t.ifError(err);

        if (addOwner) {
            // Fill in owner_uuids entries in NETWORKS global
            net.owner_uuids.push(client.account.uuid);
        }

        client.napi.createNetwork(net, function (err2, _net) {
            t.ifError(err);

            // Fill in uuid entries in NETWORKS global
            net.uuid = _net.uuid;

            callback();
        });
    });
}



function removeNetwork(t, net, callback) {
    client.napi.deleteNetwork(net.uuid, function (err) {
        client.napi.deleteNicTag(net.nic_tag, function (err2) {
            t.ifError(err2);
            callback();
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

    serverMac = nic['MAC Address'];

    var args = {
        action: 'update',
        nics: [ {
            mac: serverMac,
            nic_tags_provided: nicTags
        } ]
    };

    client.cnapi.updateNics(server.uuid, args, function (err, res) {
        t.ifError(err);
        callback(null, res);
    });
}



function removeTagsFromServer(t, nicTags, server, callback) {
    var args = {
        action: 'delete',
        nics: [ {
            mac: serverMac,
            nic_tags_provided: nicTags
        } ]
    };

    client.cnapi.updateNics(server.uuid, args, function (err) {
        t.ifError(err);
        callback();
    });
}



function getErr(t, path, expectedErr) {
    client.get(path, function (err, req, res, body) {
        t.equal(res.statusCode, expectedErr.statusCode);
        t.equivalent(err, expectedErr);
        t.equivalent(body, expectedErr.body);

        t.end();
    });
}



function postErr(t, path, args, expectedErr) {
    verifyUnchangedNics(t, function (next) {
        client.post(path, args, function (err, req, res, body) {
            t.equal(res.statusCode, expectedErr.statusCode);
            t.equivalent(err, expectedErr);
            t.equivalent(body, expectedErr.body);

            next();
        });
    });
}



function delErr(t, path, expectedErr) {
    verifyUnchangedNics(t, function (next) {
        client.del(path, function (err, req, res, body) {
            t.equal(res.statusCode, expectedErr.statusCode);
            t.equivalent(err, expectedErr);
            t.equivalent(body, expectedErr.body);

            next();
        });
    });
}



function verifyUnchangedNics(t, mutator) {
    client.napi.listNics({
        belongs_to_type: 'zone'
    }, function (err, origNics) {
        t.ifError(err);

        t.ok(origNics.length > 0);

        mutator(function () {
            // check nics didn't change
            client.napi.listNics({
                belongs_to_type: 'zone'
            }, function (err2, newNics) {
                t.ifError(err2);
                t.equivalent(sortNics(origNics), sortNics(newNics));
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