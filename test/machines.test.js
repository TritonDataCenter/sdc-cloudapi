/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019, Joyent, Inc.
 */

var util = require('util');
var test = require('@smaller/tap').test;
var restify = require('restify');
var vasync = require('vasync');

var common = require('./common');
var uuid = common.uuid;
var addPackage = common.addPackage;
var checkNotFound = common.checkNotFound;
var machinesCommon = require('./machines/common');
var checkMachine = machinesCommon.checkMachine;
var waitForJob = machinesCommon.waitForJob;


// --- Globals


var SDC_128 = common.sdc_128_package; // already loaded in PAPI

var SDC_256_INACTIVE =  {
    uuid: '4633473b-aae9-466b-8bde-3c410e5072cc',
    name: 'sdc_256_inactive',
    version: '1.0.0',
    max_physical_memory: 256,
    quota: 10240,
    max_swap: 512,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    'default': false,
    vcpus: 1,
    active: false
};

var SDC_256 = {
    uuid: '455fc2ef-b72e-4360-8d8e-09c589e06470',
    name: 'sdc_256',
    version: '1.0.0',
    max_physical_memory: 256,
    quota: 10240,
    max_swap: 512,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    'default': false,
    vcpus: 1,
    active: true
};

var SDC_128_LINUX = {
    uuid: '0f06a3b8-4c54-4408-bb17-ffb34290867e',
    name: 'sdc_128_os',
    version: '1.0.0',
    os: 'linux',
    max_physical_memory: 128,
    quota: 10240,
    max_swap: 256,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    'default': false,
    vcpus: 1,
    active: true
};

var SDC_512 = {
    uuid: '58d1a02c-177e-4992-ac79-63a15230f57f',
    name: 'sdc_512',
    version: '1.0.0',
    max_physical_memory: 512,
    quota: 10240,
    max_swap: 1024,
    cpu_cap: 150,
    max_lwps: 2000,
    zfs_io_priority: 10,
    'default': false,
    vcpus: 1,
    active: true
};

var SERVER_UUID;
var IMAGE_UUID;
var MACHINE_UUID;
var NETWORK1_UUID;
var NETWORK2_UUID;
var NETWORK1_IP = '10.99.66.50';
var NETWORK2_IP = '10.99.67.50';

var TEST_SERVER;
var NIC_TAG;
var NIC_TAG_NAME = 'cloudapi_test_machines_nictag';

var CLIENTS;
var CLIENT;
var OTHER;
var SERVER;


// --- Tests


test('setup', function (t) {
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        OTHER   = clients.other;
        SERVER  = server;

        addPackage1();

        // Add custom packages; "sdc_" ones will be owned by admin user:
        function addPackage1() {
            addPackage(CLIENT, SDC_256_INACTIVE, function (err) {
                t.ifError(err, 'Add package error');

                addPackage2();
            });
        }

        function addPackage2() {
            addPackage(CLIENT, SDC_128_LINUX, function (err) {
                t.ifError(err, 'Add package error');

                addPackage3();
            });
        }

        function addPackage3() {
            addPackage(CLIENT, SDC_256, function (err) {
                t.ifError(err, 'Add package error');
                addPackage4();
            });
        }

        function addPackage4() {
            addPackage(CLIENT, SDC_512, function (err) {
                t.ifError(err, 'Add package error');
                t.end();
            });
        }
    });
});


test('Get test server', function (t) {
    common.getTestServer(CLIENT, function onGetTestServer(err, testServer) {
        t.ifError(err);
        TEST_SERVER = testServer;
        SERVER_UUID = testServer.uuid;
        t.end();
    });
});

test('Create nic tag', function (t) {
    getOrCreateNicTag(NIC_TAG_NAME, CLIENT, function onGetOrCreate(err, tag) {
        t.ifError(err, 'createNicTag: nicTag ' + NIC_TAG_NAME);
        NIC_TAG = tag;
        t.end();
    });
});

test('Add nic tag to test server', function (t) {
    if (!NIC_TAG) {
        t.end();
        return;
    }
    var nicTags = [NIC_TAG_NAME];

    common.addNicTagsToServer(nicTags, TEST_SERVER, CLIENT,
        function onAddNicTagsToServer(addNicTagsErr, job) {
        t.ifError(addNicTagsErr, 'add NIC tags to server: ' + nicTags);
        waitForJob(CLIENT, job.job_uuid, function (jobErr) {
            t.ifError(jobErr);
            t.end();
        });
    });
});


test('Get base image', function (t) {
    common.getTestImage(CLIENT, function (err, img) {
        t.ifError(err);
        IMAGE_UUID = img.id;
        t.end();
    });
});


test('ListMachines (empty)', function (t) {
    CLIENT.get('/my/machines', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines Status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'body is an array');
        t.ok(!body.length, 'body array is empty');
        t.end();
    });
});


test('Create machine with inactive package', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_256_INACTIVE.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: SERVER_UUID
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, _body) {
        t.ok(err, 'POST /my/machines with inactive package error');
        t.equal(res.statusCode, 409);
        t.end();
    });
});


test('Create machine with os mismatch', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_128_LINUX.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: SERVER_UUID,
        firewall_enabled: true
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.statusCode, 409);
        t.equal(body.code, 'InvalidArgument');
        t.equal(body.message, 'The package and image must have the same OS, ' +
            'but package has "smartos" while image has "linux"');
        t.end();
    });
});


// NB: this test only applies if the config doesn't set
// allow_multiple_public_networks to true, which isn't set in JPC standups
test('Create machine with too many public networks', function (t) {
    var fakeNetwork = {
        'name': 'test external 2',
        'vlan_id': 613,
        'subnet': '10.66.62.0/24',
        'netmask': '255.255.255.0',
        'provision_start_ip': '10.66.62.10',
        'provision_end_ip': '10.66.62.240',
        'nic_tag': 'external',
        'owner_uuids': []
    };

    function createMachine(networkUuids, next) {
        var obj = {
            image: IMAGE_UUID,
            package: SDC_256.name,
            name: 'a' + uuid().substr(0, 7),
            server_uuid: SERVER_UUID,
            firewall_enabled: true,
            networks: networkUuids
        };

        CLIENT.post('/my/machines', obj, function (err, req, res, body) {
            t.ok(err);
            t.equal(err.statusCode, 409);
            t.equal(body.code, 'InvalidArgument');
            t.equal(body.message, 'Can specify a maximum of 1 public networks');
            next();
        });
    }

    function addNetwork(networkDesc, next) {
        CLIENT.napi.createNetwork(networkDesc, function (err, network) {
            t.ifError(err);
            next(null, network.uuid);
        });
    }

    function removeNetwork(networkUuid, next) {
        CLIENT.napi.deleteNetwork(networkUuid, next);
    }

    CLIENT.napi.listNetworks({ nic_tag: 'external' }, function (err, nets) {
        t.ifError(err);

        var networkUuids = nets.map(function (net) { return net.uuid; });

        if (nets.length > 1) {
            createMachine(networkUuids, function () {
                t.end();
            });

        } else if (nets.length === 1) {
            addNetwork(fakeNetwork, function (_, newNetUuid) {
                createMachine(networkUuids.concat(newNetUuid), function () {
                    removeNetwork(newNetUuid, function () {
                        t.end();
                    });
                });
            });

        } else {
            // shouldn't end up here
            t.ok(false);
            t.end();
        }
    });
});


test('CreateMachine using invalid networks', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_256.name,
        server_uuid: SERVER_UUID,
        networks: ['8180ef72-40fa-4b86-915b-803bcf96b442'] // invalid
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.statusCode, 409);
        t.deepEqual(body, {
            code: 'InvalidArgument',
            message: 'Invalid Networks'
        });

        t.end();
    });
});


test('CreateMachine using network without permissions', function (t) {
    var netDetails = {
        name: 'network-test-fake',
        vlan_id: 99,
        subnet: '10.99.66.0/24',
        provision_start_ip: '10.99.66.5',
        provision_end_ip: '10.99.66.250',
        nic_tag: 'external',
        owner_uuids: ['fbae7be9-922f-48cf-b935-e3027881fca0']
    };

    var vmDetails = {
        image: IMAGE_UUID,
        package: SDC_256.name,
        server_uuid: SERVER_UUID
    };

    CLIENT.napi.createNetwork(netDetails, function (err, net) {
        t.ifError(err);

        vmDetails.networks = [net.uuid];

        CLIENT.post('/my/machines', vmDetails, function (machineCreateErr, req,
            res, body) {
            t.ok(machineCreateErr);
            if (machineCreateErr) {
                t.equal(machineCreateErr.statusCode, 409);
            }
            t.deepEqual(body, {
                code: 'InvalidArgument',
                message: 'Invalid Networks'
            });

            CLIENT.napi.deleteNetwork(net.uuid, {}, function (err3) {
                t.ifError(err3);
                t.end();
            });
        });
    });
});


test('CreateMachine using public network and ip', function (t) {
    var netDetails = {
        name: 'machines-test-network-fake-public',
        vlan_id: 99,
        subnet: '10.99.66.0/24',
        provision_start_ip: '10.99.66.5',
        provision_end_ip: '10.99.66.250',
        nic_tag: 'external',
        owner_uuids: []
    };

    var vmDetails = {
        image: IMAGE_UUID,
        package: SDC_256.name,
        server_uuid: SERVER_UUID
    };

    CLIENT.napi.createNetwork(netDetails, function (err, net) {
        t.ifError(err);

        vmDetails.networks = [
            {
                ipv4_uuid: net.uuid,
                ipv4_ips: ['10.99.66.10']
            }
        ];

        CLIENT.post('/my/machines', vmDetails, function (machineCreateErr, req,
            res, body) {
            t.ok(machineCreateErr);
            if (machineCreateErr) {
                t.equal(machineCreateErr.statusCode, 409);
            }
            t.deepEqual(body, {
                code: 'InvalidArgument',
                message: 'ipv4_uuid: ' + net.uuid +
                        ' cannot specify IP on a public network'
            });

            CLIENT.napi.deleteNetwork(net.uuid, {},
                function napiDeleteNetwork(networkDelErr) {
                t.ifError(networkDelErr);
                t.end();
            });
        });
    });
});


test('CreateMachine using unknown network and an ip', function (t) {
    var networkUuid = 'd674f27a-e695-11e7-8490-001fc69cf4fd';
    var vmDetails = {
        image: IMAGE_UUID,
        package: SDC_256.name,
        server_uuid: SERVER_UUID,
        networks: [
            {
                ipv4_uuid: networkUuid,
                // IP set to any value just for this test
                ipv4_ips: ['10.99.66.10']
            }
        ]
    };

    CLIENT.post('/my/machines', vmDetails, function (machineCreateErr, req, res,
        body) {
        t.ok(machineCreateErr);
        if (machineCreateErr) {
            t.equal(machineCreateErr.statusCode, 404);
        }
        t.deepEqual(body, {
            code: 'ResourceNotFound',
            message: 'ipv4_uuid: network ' + networkUuid +
                ' not found'
        });

        t.end();
    });
});


test('CreateMachine using network pool and an ip', function (t) {
    var networkPoolUuid;
    var networkUuids = [];
    var networks = [
        {
            name: 'machines-test-network-pool-fake-1',
            vlan_id: 97,
            subnet: '10.99.55.0/24',
            provision_start_ip: '10.99.55.5',
            provision_end_ip: '10.99.55.250',
            nic_tag: 'external',
            owner_uuids: []
        },
        {
            name: 'machines-test-network-pool-fake-2',
            vlan_id: 98,
            subnet: '10.99.67.0/24',
            provision_start_ip: '10.99.67.5',
            provision_end_ip: '10.99.67.250',
            nic_tag: 'external',
            owner_uuids: []
        }
    ];


    function createNetwork(params, done) {
        CLIENT.napi.createNetwork(params, function (err, net) {
            if (err) {
                done(err);
                return;
            }
            networkUuids.push(net.uuid);
            done();
        });
    }

    function createNetworksForPool(_, done) {
        vasync.forEachPipeline({
            func: createNetwork,
            inputs: networks
        }, function (err, results) {
            if (err) {
                done(err);
                return;
            }
            done();
        });
    }

    function createPool(_, done) {
        CLIENT.napi.createNetworkPool('network-pool-fake',
            {networks: networkUuids}, function (err, net) {
            if (err) {
                done(err);
                return;
            }
            networkPoolUuid = net.uuid;
            done();
        });
    }

    function runTest(_, done) {
        var vmDetails = {
            image: IMAGE_UUID,
            package: SDC_256.name,
            server_uuid: SERVER_UUID,
            networks: [
                {
                    ipv4_uuid: networkPoolUuid,
                    // IP set to any value just for this test
                    ipv4_ips: ['10.99.66.10']
                }
            ]
        };
        CLIENT.post('/my/machines', vmDetails, function (machineCreateErr, req,
            res, body) {
            t.ok(machineCreateErr);
            if (machineCreateErr) {
                t.equal(machineCreateErr.statusCode, 409);
            }
            t.deepEqual(body, {
                code: 'InvalidArgument',
                message: 'ipv4_uuid: ' + networkPoolUuid +
                        ' cannot specify IP on a network pool'
            });

            // Call done without error since we expect to get one
            done();
        });
    }

    vasync.pipeline({
        funcs: [createNetworksForPool, createPool, runTest]
    }, function (_err, results) {
        // Regardless of errors we should cleanup and end the test
        CLIENT.napi.deleteNetworkPool(networkPoolUuid,
            function (delNetworkPoolErr, _net) {
            t.ifError(delNetworkPoolErr);

            function deleteNetwork(netUuid, done) {
                CLIENT.napi.deleteNetwork(netUuid,
                    function (delNetworkErr, _) {
                    t.ifError(delNetworkErr);
                    done();
                });
            }

            vasync.forEachParallel({
                func: deleteNetwork,
                inputs: networkUuids
            }, function (delPipelineErr, _) {
                t.ifError(delPipelineErr);
                t.end();
            });
        });
    });
});


test('Create machine with invalid parameters', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_256.name,
        // Underscore will make name invalid:
        name: '_a' + uuid().substr(0, 7),
        // Obviously, not a valid UUID, but we don't want to notify customers
        // about this:
        server_uuid: '123456'
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, _body) {
        t.ok(err, 'POST Create machine with invalid parameters');
        t.ok(/name/.test(err.message));
        t.notOk(/server/.test(err.message));
        t.end();
    });
});


test('Create machine with invalid locality', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_256.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: SERVER_UUID,
        locality: { near: 'asdasd' }
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, body) {
        t.equal(err.statusCode, 409);
        t.deepEqual(body, {
            code: 'ValidationFailed',
            message: 'Invalid VM parameters',
            errors: [ {
                field: 'locality',
                code: 'Invalid',
                message: 'locality contains malformed UUID'
            } ]
        });
        t.end();
    });
});


test('CreateMachine using image without permission', function (t) {
    CLIENT.imgapi.listImages(function (err, images) {
        t.ifError(err);

        var accountUuid = CLIENT.account.uuid;
        var inaccessibleImage = images.filter(function (img) {
            return img.owner !== accountUuid && !img.public;
        })[0];

        if (!inaccessibleImage) {
            // can't continue test, so move on
            return t.end();
        }

        var obj = {
            image: inaccessibleImage.uuid,
            package: SDC_256.name,
            server_uuid: SERVER_UUID
        };

        return CLIENT.post('/my/machines', obj, function (er2, req, res, body) {
            t.ok(er2);
            t.equal(er2.statusCode, 404);

            t.deepEqual(body, {
                code: 'ResourceNotFound',
                message: 'image not found'
            });

            t.end();
        });
    });
});


// We need to create a new user here, because the ufds entries cached
// inside cloudapi conflict with simple updates of the existing user. That
// implies skipping using the existing http client.
test('CreateMachine without approved_for_provisioning', function (t) {
    function attemptProvision(err, _tmpAccount, signer, cb) {
        t.ifError(err);

        var httpClient = restify.createJsonClient({
            url: CLIENT.url.href, // grab from old client
            retryOptions: { retry: 0 },
            log: CLIENT.log,
            rejectUnauthorized: false,
            signRequest: signer
        });

        var obj = {
            image: IMAGE_UUID,
            package: SDC_256.name,
            server_uuid: SERVER_UUID
        };

        httpClient.post('/my/machines', obj, function (err2, req, res, body) {
            t.ok(err2);

            t.deepEqual(body, {
                code: 'InvalidArgument',
                message: 'User is not currently approved for provisioning'
            });

            httpClient.close();

            cb();
        });
    }

    function done() {
        t.end();
    }

    var opts = {
        approved_for_provisioning: false
    };

    common.withTemporaryUser(CLIENT.ufds, opts, attemptProvision, done);
});


// Test using IMAGE.uuid instead of IMAGE.name due to PUBAPI-625:
test('CreateMachine', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_256.name,
        name: 'a' + uuid().substr(0, 7),
        locality: {
            far: 'af4167f0-beda-4af9-9ae4-99d544499c14', // fake UUID
            strict: true
        },
        server_uuid: SERVER_UUID,
        deletion_protection: true,
        firewall_enabled: true
    };

    machinesCommon.createMachine(t, CLIENT, obj, function (_, machineUuid) {
        MACHINE_UUID = machineUuid;
        t.end();
    });
});


test('Wait For Running Machine 1', waitForRunning);


test('ListMachines all', function (t) {
    CLIENT.get('/my/machines', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'GET /my/machines body is array');
        t.ok(body.length, 'GET /my/machines list is not empty');

        body.forEach(function (m) {
            if (m.state === 'failed') {
                return;
            }

            checkMachine(t, m);
        });

        t.end();
    });
});


test('ListMachines all - other', function (t) {
    OTHER.get('/my/machines', function (err, req, res, body) {
        t.ifError(err);
        t.deepEqual(body, []);
        t.end();
    });
});


// Fixed by PUBAPI-774, again!
test('ListMachines (filter by image)', function (t) {
    searchAndCheck('image=' + IMAGE_UUID, t, function (m) {
        t.equal(m.image, IMAGE_UUID);
    });
});


test('ListMachines (filter by image) - other', function (t) {
    searchAndCheckOther('image=' + IMAGE_UUID, t);
});


test('ListMachines (filter by state)', function (t) {
    searchAndCheck('state=running', t, function (m) {
        t.equal(m.state, 'running');
    });
});


test('ListMachines (filter by state) - other', function (t) {
    searchAndCheckOther('state=running', t);
});


test('ListMachines (filter by state)', function (t) {
    searchAndCheck('state=running', t, function (m) {
        t.equal(m.state, 'running');
    });
});


test('ListMachines (filter by state) - other', function (t) {
    searchAndCheckOther('state=running', t);
});


test('ListMachines (filter by memory)', function (t) {
    searchAndCheck('memory=256', t, function (m) {
        t.equal(m.memory, 256);
    });
});


test('ListMachines (filter by memory) - other', function (t) {
    searchAndCheckOther('memory=256', t);
});


test('ListMachines (filter by package) - other', function (t) {
    searchAndCheckOther('package=' + SDC_256.name, t);
});


test('ListMachines (filter by smartmachine type)', function (t) {
    searchAndCheck('type=smartmachine', t, function (m) {
        t.equal(m.type, 'smartmachine');
        t.equal(m.brand, 'joyent');
        // at the moment, only the machine created in the above tests should
        // list here:
        t.equal(m.id, MACHINE_UUID);
    });
});


test('ListMachines (filter by smartmachine type) - other', function (t) {
    searchAndCheckOther('type=smartmachine', t);
});


test('ListMachines (filter by virtualmachine type)', function (t) {
    var path = '/my/machines?type=virtualmachine';

    CLIENT.get(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(Array.isArray(body));

        // at the moment, only the machine created in the above tests should
        // list, but it's not a virtualmachine, so for now:
        t.equal(body.length, 0);

        // body.forEach(function (m) {
        //     checkMachine(t, m);
        //     t.equal(m.type, 'virtualmachine');
        //     t.equal(m.brand, 'kvm');
        // });

        t.end();
    });
});


test('ListMachines (filter by virtualmachine type) - other', function (t) {
    searchAndCheckOther('type=virtualmachine', t);
});


test('ListMachines (filter by joyent brand)', function (t) {
    searchAndCheck('brand=joyent', t, function (m) {
        t.equal(m.brand, 'joyent');
        // at the moment, only the machine created in the above tests should
        // list here:
        t.equal(m.id, MACHINE_UUID);
    });
});


test('ListMachines (filter by joyent brand) - other', function (t) {
    searchAndCheckOther('brand=joyent', t);
});


test('ListMachines (filter by docker true)', function (t) {
    CLIENT.get('/my/machines?docker=true', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.ok(body, 'should have a body');

        if (body) {
            body.forEach(function (vm) {
                t.equal(vm.docker, true);
            });
        }

        t.end();
    });
});


test('ListMachines (filter by docker false)', function (t) {
    CLIENT.get('/my/machines?docker=false', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.ok(body.length > 0);

        body.forEach(function (vm) {
            t.equal(vm.docker, undefined);
        });

        t.end();
    });
});


test('ListMachines (filter by docker) - other', function (t) {
    searchAndCheckOther('docker=false', t);
});


test('ListMachines (filter by bad type)', function (t) {
    var path = '/my/machines?type=0xdeadbeef';

    return CLIENT.get(path, function (err, req, res, body) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        common.checkHeaders(t, res.headers);

        t.deepEqual(body, {
            code: 'InvalidArgument',
            message: '0xdeadbeef is not a valid type'
        });

        t.end();
    });
});


test('Get Machine', function (t) {
    machinesCommon.getMachine(t, CLIENT, MACHINE_UUID, function (_, machine) {
        // Double check tags are OK, due to different handling by VMAPI:
        var tags = {};
        tags[machinesCommon.TAG_KEY] = machinesCommon.TAG_VAL;
        t.deepEqual(machine.tags, tags, 'Machine tags');

        t.equal(machine.deletion_protection, true, 'deletion protection');

        t.end();
    });
});


test('Get Machine - other', function (t) {
    OTHER.get('/my/machines/' + MACHINE_UUID, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('Get Machine, including credentials', function (t) {
    var url = '/my/machines/' + MACHINE_UUID + '?credentials=true';

    CLIENT.get(url, function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines/:id error');
        t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines/:id body');
        checkMachine(t, body);

        t.equal(typeof (body.metadata.credentials), 'object');
        Object.keys(machinesCommon.META_CREDS).forEach(function (k) {
            t.equal(body.metadata.credentials[k], machinesCommon.META_CREDS[k]);
        });

        t.end();
    });
});


test('Stop test', function (t) {
    var stopTest = require('./machines/stop');
    stopTest(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('Start test', function (t) {
    var startTest = require('./machines/start');
    startTest(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('Reboot test', function (t) {
    var rebootTest = require('./machines/reboot');
    rebootTest(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('Resize machine to inactive package', function (t) {
    CLIENT.post('/my/machines/' + MACHINE_UUID, {
        action: 'resize',
        package: SDC_256_INACTIVE.name
    }, function (err, req, res, _body) {
        t.ok(err, 'Resize to inactive package error');
        t.equal(res.statusCode, 409, 'Resize to inactive pkg status');
        t.end();
    });
});


test('Resize machine tests', function (t) {
    var resizeTest = require('./machines/resize');
    resizeTest(t, CLIENT, OTHER, MACHINE_UUID, SDC_128, SDC_256, SDC_512,
            function () {
        t.end();
    });
});


test('Tags tests', function (t) {
    var testTags = require('./machines/tags');
    testTags(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('Metadata tests', function (t) {
    var testMetadata = require('./machines/metadata');
    testMetadata(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('Snapshots tests', function (t) {
    var testSnapshots = require('./machines/snapshots');
    testSnapshots(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('Firewall Rules tests', function (t) {
    var testFirewallRules = require('./machines/firewall-rules');
    testFirewallRules(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('Check cannot delete machine with deletion_protection set',
function (t) {
    CLIENT.del('/my/machines/' + MACHINE_UUID,
        function delCb(err, req, res, body) {

        t.ok(err, 'delete error expected');
        t.equal(res.statusCode, 409, 'http code');
        t.deepEqual(body, {
            code: 'CannotDestroyMachineError',
            message: 'Instance has "deletion_protection" enabled, ' +
                'preventing deletion'
        }, 'check error message');

        t.end();
    });
});


test('Remove deletion_protection', function (t) {
    CLIENT.post('/my/machines/' + MACHINE_UUID, {
        action: 'disable_deletion_protection'
    }, function removeProtectionCb(err, req, res) {
        t.ifError(err, 'disable_deletion_protection error');
        t.equal(res.statusCode, 202, 'http code');

        CLIENT.vmapi.listJobs({
            vm_uuid: MACHINE_UUID,
            task: 'update'
        }, function listCb(err2, jobs) {
            t.ifError(err2, 'list jobs error');

            machinesCommon.waitForJob(CLIENT, jobs[0].uuid,
                function waitCb(err3) {

                t.ifError(err3, 'wait for job error');
                t.end();
            });
        });
    });
});


test('Delete tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('machine audit', function (t) {
    var p = '/my/machines/' + MACHINE_UUID + '/audit';

    t.ok(true, p);
    CLIENT.get(p, function (err, req, res, body) {
        t.ifError(err, 'CLIENT.get error');
        t.ok(Array.isArray(body), 'body is array');
        t.ok(body.length > 0, 'body non-zero length');

        var f = body[body.length - 1];
        t.ok(f.success, 'f.success: ' + f.success);
        t.ok(f.time, 'f.time: ' + f.time);
        t.ok(f.action, 'f.action: ' + f.action);
        t.ok(f.caller, 'f.caller: ' + f.caller);
        t.ok(f.caller.type, 'f.caller.type: ' + f.caller.type);
        t.equal(f.caller.type, 'signature', 'f.caller.type == signature');
        t.ok(f.caller.ip, 'f.caller.ip: ' + f.caller.ip);
        t.ok(f.caller.keyId, 'f.caller.keyId: ' + f.caller.keyId);

        var expectedJobs = [
            'destroy', 'disable_deletion_protection', 'delete_snapshot',
            'rollback_snapshot', 'create_snapshot', 'replace_metadata',
            'remove_metadata', 'set_metadata', 'remove_tags', 'replace_tags',
            'remove_tags', 'set_tags', 'resize', 'resize', 'resize', 'reboot',
            'start', 'stop', 'provision'
        ];

        for (var i = 0; i !== expectedJobs.length; i++) {
            var expected = expectedJobs[i];
            var job      = body[i];
            t.ok(job, 'expected job: ' + expected);

            var caller   = job.caller;

            if (expected === 'replace_tags') {
                // since we're updating tags fairly quickly in these tests,
                // vmapi doesn't promise immediate consistency, we have to
                // accept that sometimes the replace_tags job only adds a tag
                t.ok(job.action === 'replace_tags' || job.action === 'set_tags',
                    'action match');
            } else {
                t.equal(job.action, expected, 'action match');
            }
            t.equal(caller.type, 'signature', 'caller.type == signature');
            t.ok(caller.ip, 'caller.ip: ' + caller.ip);
            t.ok(caller.keyId.indexOf('test@joyent.com/keys/id_rsa') !== -1,
                'test key found');
        }

        t.end();
    });
});


test('machine audit - other', function (t) {
    var p = '/my/machines/' + MACHINE_UUID + '/audit';

    OTHER.get(p, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('ListMachines tombstone', function (t) {
    CLIENT.get('/my/machines?tombstone=20', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'GET /my/machines body is array');
        t.equal(body.length, 1, 'GET /my/machines list is not empty');
        t.equal(body[0].id, MACHINE_UUID);
        t.end();
    });
});


test('ListMachines tombstone - other', function (t) {
    OTHER.get('/my/machines?tombstone=20', function (err, req, res, body) {
        t.ifError(err);
        t.deepEqual(body, []);
        t.end();
    });
});


test('ListMachines exclude tombstone', function (t) {
    CLIENT.get('/my/machines', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'GET /my/machines body is array');
        t.notOk(body.some(function (m) {
            return (m.id === MACHINE_UUID);
        }));
        t.end();
    });
});


test('ListMachines destroyed', function (t) {
    CLIENT.get('/my/machines?state=destroyed', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'GET /my/machines body is array');
        t.ok(body.length, 'GET /my/machines list is not empty');
        t.ok(body.some(function (m) {
            return (m.id === MACHINE_UUID);
        }));
        t.end();
    });
});

test('CreateMachine using query args', function (t) {
    var query = '/my/machines?image=' + IMAGE_UUID +
                '&package=' + SDC_128.name +
                '&server_uuid=' + SERVER_UUID;

    CLIENT.post(query, {}, function (err, req, res, body) {
        t.ifError(err, 'POST /my/machines error');
        t.equal(res.statusCode, 201, 'POST /my/machines status');
        common.checkHeaders(t, res.headers);
        t.equal(res.headers.location,
            util.format('/%s/machines/%s', CLIENT.login, body.id));
        t.ok(body, 'POST /my/machines body');
        checkMachine(t, body);

        MACHINE_UUID = body.id;

        // Handy to output this to stdout in order to poke around COAL:
        console.log('Requested provision of machine: %s', MACHINE_UUID);
        t.end();
    });
});


test('Wait For Running Machine 2', waitForRunning);


test('DeleteMachine which used query args', deleteMachine);


// passing in multiple same networks should flatten to single network added
test('CreateMachine using multiple same networks', function (t) {
    CLIENT.napi.listNetworks({ nic_tag: 'external' }, function (err, nets) {
        t.ifError(err);

        var networkUuid = nets[0].uuid;

        var obj = {
            image: IMAGE_UUID,
            package: SDC_128.name,
            server_uuid: SERVER_UUID,
            networks: [networkUuid, networkUuid, networkUuid]
        };

        machinesCommon.createMachine(t, CLIENT, obj, function (_, machineUuid) {
            MACHINE_UUID = machineUuid;
            // see next couple following tests for asserts
            t.end();
        });
    });
});


test('Wait For Running Machine 3', waitForRunning);


test('Check CreateMachine flattens same networks', function (t) {
    CLIENT.vmapi.getVm({ uuid: MACHINE_UUID }, function (err, vm) {
        t.ifError(err);
        t.equal(vm.nics.length, 1);
        t.end();
    });
});


test('DeleteMachine which flattened networks', deleteMachine);


test('Create Docker machine', function (t) {
    var ownerUuid = CLIENT.account.uuid;
    var vmDescription = {
        owner_uuid: ownerUuid,
        uuid: uuid(),
        alias: 'cloudapi-fake-docker-test',
        internal_metadata: {
            'docker:id': ownerUuid,
            'docker:tty': true,
            'docker:attach_stdin': true,
            'docker:attach_stdout': true,
            'docker:attach_stderr': true,
            'docker:open_stdin': true,
            'docker:noipmgmtd': true,
            'docker:cmd': '["/bin/bash"]',
            'docker:entrypoint': '[]'
        },
        tags: {
            'docker:label:com.docker.blah': 'quux'
        },
        autoboot: true, // false
        docker: true,
        brand: 'joyent-minimal',  // should be lx, but we're abusing this
        networks: [ {
            uuid: '', // filled in below
            primary: true
        } ],
        billing_id: SDC_128.uuid,
        image_uuid: IMAGE_UUID
    };

    CLIENT.napi.listNetworks({ nic_tag: 'external' }, function (err, nets) {
        t.ifError(err);

        vmDescription.networks[0].uuid = nets[0].uuid;

        CLIENT.vmapi.createVm(vmDescription, function (err2, vm) {
            t.ifError(err2);

            MACHINE_UUID = vm.vm_uuid;

            t.end();
        });
    });
});


test('Wait for running Docker machine', waitForRunning);


test('Check Docker machine can resize', function (t) {
    CLIENT.post('/my/machines/' + MACHINE_UUID, {
        action: 'resize',
        package: SDC_128_LINUX.name
    }, function (err, req, res, body) {
        t.ifErr(err, 'Prevent resize machine error');
        t.equal(res.statusCode, 202);
        t.deepEqual(body, {});
        t.end();
    });
});


test('Wait for resize of Docker machine', waitForResize);


test('Check Docker machine resized', function (t) {
    CLIENT.get('/my/machines/' + MACHINE_UUID, function (err, req, res, body) {
        t.ifError(err, 'Get machines error');
        t.equal(body.package, SDC_128_LINUX.name, 'correct package name');
        t.end();
    });
});


test('Check GetMachine for Docker machine has true docker attr', function (t) {
    CLIENT.get('/my/machines/' + MACHINE_UUID, function (err, req, res, body) {
        t.ifError(err);
        t.equal(body.docker, true);
        t.end();
    });
});


test('Check ListMachines has true docker attr on Docker machine', function (t) {
    CLIENT.get('/my/machines', function (err, req, res, body) {
        t.ifError(err);

        var dockerMachine = body.filter(function (vm) {
            return vm.id === MACHINE_UUID;
        })[0];

        t.equal(dockerMachine.docker, true);

        t.end();
    });
});


test('Check cannot update Docker machine tag', function (t) {
    CLIENT.post('/my/machines/' + MACHINE_UUID + '/tags', {
        'docker:label:com.docker.blah': 'baz'
    }, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.restCode, 'ValidationFailed');
        t.equal(err.message, 'error adding tags: Invalid tag parameters');
        t.equal(res.statusCode, 409);

        t.deepEqual(body, {
            code: 'ValidationFailed',
            message: 'error adding tags: Invalid tag parameters',
            errors: [ {
                field: 'tags',
                code: 'Invalid',
                message: 'Special tag "docker:label:com.docker.blah" not ' +
                    'supported'
            } ]
        });

        t.end();
    });
});


test('Check cannot replace tags containing Docker machine tag', function (t) {
    CLIENT.put('/my/machines/' + MACHINE_UUID + '/tags', {
        foo: 'bar'
    }, function (err, req, res, body) {
        checkTagReplaceValidationError(t, err, req, res, body);
        t.end();
    });
});


test('Check can list Docker machines only', function (t) {
    CLIENT.get('/my/machines?docker=true', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.ok(body.length > 0);

        body.forEach(function (vm) {
            t.equal(vm.docker, true);
        });

        t.end();
    });
});


test('Check can list non-Docker machines only', function (t) {
    CLIENT.get('/my/machines?docker=false', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        body.forEach(function (vm) {
            t.equal(vm.docker, undefined);
        });

        t.end();
    });
});


test('ListMachines (filter by docker) - other', function (t) {
    searchAndCheckOther('docker=false', t);
});


test('Check cannot delete Docker machine tag', function (t) {
    CLIENT.del('/my/machines/' + MACHINE_UUID + '/tags/docker%3Alabel%3A' +
        'com.docker.blah',
    function (err, req, res, body) {
        checkTagDeleteValidationError(t, err, req, res, body);
        t.end();
    });
});


test('Check cannot delete all tags when containing Docker machine tag',
function (t) {
    CLIENT.del('/my/machines/' + MACHINE_UUID + '/tags',
            function (err, req, res, body) {
        checkTagDeleteAllValidationError(t, err, req, res, body);
        t.end();
    });
});


test('Delete Docker machine', deleteMachine);


// Test using {{shortId}} in alias
test('CreateMachine with {{shortId}} in alias', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_256.name,
        name: 'db-{{shortId}}-1.0',
        server_uuid: SERVER_UUID,
        firewall_enabled: true
    };

    machinesCommon.createMachine(t, CLIENT, obj, function (_, machineUuid) {
        MACHINE_UUID = machineUuid;
        t.end();
    });
});


test('Wait For Running {{shortId}} machine', waitForRunning);


test('Get {{shortId}} machine', function (t) {
    if (!MACHINE_UUID) {
        t.notOk('no MACHINE_UUID, cannot get');
        t.end();
        return;
    }

    CLIENT.get('/my/machines/' + MACHINE_UUID, function (err, req, res, body) {
        var shortId;

        t.ifError(err, 'GET /my/machines error');

        if (!err) {
            // first bit of 445a0be6-016f-e232-...
            shortId = body.id.split('-')[0];
            t.equal(body.name, 'db-' + shortId + '-1.0',
                'resulting alias was as expected');
        }

        t.end();
    });
});


test('Delete {{shortId}} machine', deleteMachine);


test('Create packageless machine', function (t) {
    var ownerUuid = CLIENT.account.uuid;
    var vmDescription = {
        owner_uuid: ownerUuid,
        alias: 'cloudapi-packageless-machine-test',
        brand: 'joyent-minimal',
        networks: [ {
            uuid: '', // filled in below
            primary: true
        } ],
        ram: 64,
        cpu_cap: 50,
        image_uuid: IMAGE_UUID
    };

    CLIENT.napi.listNetworks({ nic_tag: 'external' }, function (err, nets) {
        t.ifError(err, 'listing external network');

        vmDescription.networks[0].uuid = nets[0].uuid;

        CLIENT.vmapi.createVm(vmDescription, function (err2, vm) {
            t.ifError(err2, 'Creating packageless VM');

            MACHINE_UUID = vm.vm_uuid;

            t.end();
        });
    });
});


test('Wait for running packageless machine', waitForRunning);


test('Remove nic from packageless machine', function (t) {
    CLIENT.vmapi.getVm({ uuid: MACHINE_UUID }, function (err, vm) {
        t.ifError(err, 'getting VM ' + MACHINE_UUID);

        var nic = vm.nics[0];

        CLIENT.vmapi.removeNics({
            uuid: MACHINE_UUID,
            macs: [nic.mac]
        }, function (err2, job) {
            t.ifError(err2, 'Removing nic ' + nic.mac);

            waitForJob(CLIENT, job.job_uuid, function (err3) {
                t.ifError(err3, 'waiting for job ' + job.job_uuid);
                t.end();
            });
        });
    });
});


test('ListMachines with packageless/nicless machine', function (t) {
    CLIENT.get('/my/machines', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines status');
        t.ok(Array.isArray(body), 'GET /my/machines body is array');
        t.ok(body.length, 'GET /my/machines list is not empty');

        var testVm = body.filter(function (m) {
            return m.id === MACHINE_UUID;
        })[0];

        t.ok(testVm, 'packageless/nicless VM listed successfully');

        t.end();
    });
});


test('Delete packageless/nicless machine', deleteMachine);


test('Affinity tests', function (t) {
    var affinityTest = require('./machines/affinity');

    affinityTest(t, CLIENT, OTHER, IMAGE_UUID, SDC_128.uuid, SERVER_UUID,
        function () {
        t.end();
    });
});


test('Create Machine using network and IP', function (t) {
    var netDetails = {
        name: 'machines-test-network-and-ip',
        vlan_id: 99,
        subnet: '10.99.66.0/24',
        provision_start_ip: '10.99.66.5',
        provision_end_ip: '10.99.66.250',
        nic_tag: 'external',
        owner_uuids: [CLIENT.account.uuid]
    };

    var obj = {
        image: IMAGE_UUID,
        package: SDC_128.name,
        server_uuid: SERVER_UUID
    };

    CLIENT.napi.createNetwork(netDetails, function (err, net) {
        t.ifError(err);

        NETWORK1_UUID = net.uuid;

        obj.networks = [
            {
                ipv4_uuid: NETWORK1_UUID,
                ipv4_ips: [ NETWORK1_IP ]
            }
        ];

        machinesCommon.createMachine(t, CLIENT, obj, function (_, machineUuid) {
            MACHINE_UUID = machineUuid;
            t.end();
        });

    });
});


test('Wait For Running Machine provisioned with IP', waitForRunning);


test('Verify the machines IP', function (t) {
    var params = {
        belongs_to_uuid: MACHINE_UUID,
        belongs_to_type: 'zone'
    };

    CLIENT.napi.listNics(params, function napiListNics(err, nics) {
        t.ifError(err);

        var found = nics.some(function nicHasIp(n) {
            return n.ip === NETWORK1_IP;
        });

        t.ok(found, 'nic with correct ip found');
        t.end();
    });
});


test('Create Machine using network and in use IP', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_128.name,
        server_uuid: SERVER_UUID,
        networks: [
            {
                ipv4_uuid: NETWORK1_UUID,
                ipv4_ips: [ NETWORK1_IP ]
            }
        ]
    };

    CLIENT.post('/my/machines', obj, function createMachine(err, req, res,
        body) {
        t.ok(err);
        if (err) {
            t.equal(err.statusCode, 422);
        }
        t.deepEqual(body, {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'ip',
                code: 'UsedBy',
                message: 'IP in use'
            } ]
        });
        t.end();
    });
});


test('Destroy machine created with IP', function (t) {
    CLIENT.vmapi.deleteVm({
        uuid: MACHINE_UUID,
        owner_uuid: CLIENT.account.uuid
    }, function (err, job) {
        t.ifError(err, 'Deleting machine ' + MACHINE_UUID);

        waitForJob(CLIENT, job.job_uuid, function (deleteJobErr) {
            t.ifError(deleteJobErr, 'waiting for job ' + job.job_uuid);
            t.end();
        });
    });
});


test('CreateMachine using network and invalid number of ips', function (t) {
    var vmDetails = {
        image: IMAGE_UUID,
        package: SDC_256.name,
        server_uuid: SERVER_UUID,
        networks: [
            {
                ipv4_uuid: NETWORK1_UUID,
                // IP set to any value just for this test
                ipv4_ips: ['10.99.66.10', '10.99.66.10']
            }
        ]
    };

    CLIENT.post('/my/machines', vmDetails, function (machineCreateErr, req, res,
        body) {
        t.ok(machineCreateErr);
        if (machineCreateErr) {
            t.equal(machineCreateErr.statusCode, 409);
        }
        t.deepEqual(body, {
            code: 'InvalidArgument',
            message: 'ipv4_ips: network with ipv4_uuid ' +
                    NETWORK1_UUID + ' should contain a single IP array'
        });

        t.end();
    });
});

test('Create Machine using multiple networks and IPs', function (t) {
    var netDetails = {
        name: 'machines-test-network-and-ip-2',
        vlan_id: 97,
        subnet: '10.99.67.0/24',
        provision_start_ip: '10.99.67.5',
        provision_end_ip: '10.99.67.250',
        nic_tag: NIC_TAG_NAME,
        owner_uuids: [CLIENT.account.uuid]
    };

    var obj = {
        image: IMAGE_UUID,
        package: SDC_128.name,
        server_uuid: SERVER_UUID
    };

    CLIENT.napi.createNetwork(netDetails, function (err, net) {
        t.ifError(err);

        NETWORK2_UUID = net.uuid;

        obj.networks = [
            {
                ipv4_uuid: NETWORK1_UUID,
                ipv4_ips: [ NETWORK1_IP ]
            },
            {
                ipv4_uuid: NETWORK2_UUID,
                ipv4_ips: [ NETWORK2_IP ]
            }
        ];


        machinesCommon.createMachine(t, CLIENT, obj, function (_, machineUuid) {
            MACHINE_UUID = machineUuid;
            t.end();
        });

    });
});

test('Wait For Running Machine provisioned with multiple IPs', waitForRunning);


test('Verify the machines IPs', function (t) {
    var params = {
        belongs_to_uuid: MACHINE_UUID,
        belongs_to_type: 'zone'
    };

    CLIENT.napi.listNics(params, function napiListNics(err, nics) {
        t.ifError(err);

        t.equal(nics.length, 2, 'machine has 2 NICs');

        var ip1 = nics.some(function nicHasIp1(n) {
            return n.ip === NETWORK1_IP;
        });

        var ip2 = nics.some(function nicHasIp2(n) {
            return n.ip === NETWORK2_IP;
        });

        t.ok(ip1, 'nic with ip ' + NETWORK1_IP + ' found');
        t.ok(ip2, 'nic with ip ' + NETWORK2_IP + ' found');
        t.end();
    });
});


test('Destroy machine created with multiple IPs', function (t) {
    CLIENT.vmapi.deleteVm({
        uuid: MACHINE_UUID,
        owner_uuid: CLIENT.account.uuid
    }, function (err, job) {
        t.ifError(err, 'Deleting machine ' + MACHINE_UUID);

        waitForJob(CLIENT, job.job_uuid, function (deleteJobErr) {
            t.ifError(deleteJobErr, 'waiting for job ' + job.job_uuid);
            t.end();
        });
    });
});


test('Destroy machines-test-network-and-ip network-1', function (t) {
    CLIENT.napi.deleteNetwork(NETWORK1_UUID,
        function napiDeleteNetwork(err, res) {
        t.ifError(err);
        t.end();
    });
});


test('Destroy machines-test-network-and-ip network-2', function (t) {
    CLIENT.napi.deleteNetwork(NETWORK2_UUID,
        function napiDeleteNetwork(err, res) {
        t.ifError(err);
        t.end();
    });
});


test('Remove test server nic tag', function (t) {
    if (!NIC_TAG) {
        t.end();
        return;
    }
    var nicTags = [NIC_TAG_NAME];

    common.removeTagsFromServer(nicTags, TEST_SERVER, CLIENT,
        function (err, job) {
        t.ifError(err, 'remove NIC tags from server: '
            + nicTags);

        waitForJob(CLIENT, job.job_uuid, function (jobErr) {
            t.ifError(jobErr, 'waitForJob ' + job.job_uuid);
            t.end();
        });
    });
});


test('Create Machine using "params.bootrom" without "bhyve"', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_256.name,
        name: 'a' + uuid().substr(0, 7),
        locality: {
            far: 'af4167f0-beda-4af9-9ae4-99d544499c14', // fake UUID
            strict: true
        },
        server_uuid: SERVER_UUID,
        deletion_protection: true,
        firewall_enabled: true,
        bootrom: true
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, body) {
        t.equal(err.statusCode, 409);
        t.deepEqual(body, {
            code: 'InvalidArgument',
            message: 'Only bhyve VMs support "bootrom" option'
        });
        t.end();
    });
});

test('teardown', function (t) {
    common.deletePackage(CLIENT, SDC_256, function (err) {
        common.deletePackage(CLIENT, SDC_256_INACTIVE, function (err2) {
            common.deletePackage(CLIENT, SDC_128_LINUX, function (err3) {
                common.deletePackage(CLIENT, SDC_512, function (err4) {
                    common.teardown(CLIENTS, SERVER, function (err5) {
                        t.ifError(err || err2 || err3 || err4 || err5,
                                'teardown success');
                        t.end();
                    });
                });
            });
        });
    });
});


// --- Helpers


function getOrCreateNicTag(tagName, client, callback) {
    client.napi.getNicTag(tagName, function onGetNicTag(err, nicTag) {
        if (err) {
            if (err.statusCode === 404) {
                createNicTag();
            } else {
                callback(err);
            }
        } else {
            callback(null, nicTag);
        }
    });

    function createNicTag() {
        client.napi.createNicTag(tagName, function onCreateNicTag(err, nicTag) {
            callback(err, nicTag);
        });
    }
}

function waitForRunning(t) {
    machinesCommon.waitForRunningMachine(CLIENT, MACHINE_UUID, function (err) {
        t.ifError(err);

        if (err) {
            // Skip machine tests when machine creation fails
            MACHINE_UUID = false;
        }

        t.end();
    });
}


function waitForResize(t) {
    CLIENT.vmapi.listJobs({
        vm_uuid: MACHINE_UUID,
        task: 'update'
    }, function (err, jobs) {
        t.ifError(err, 'list jobs error');

        var resizeJobs = jobs.filter(function (job) {
            return job.params.subtask === 'resize';
        });

        machinesCommon.waitForJob(CLIENT, resizeJobs[0].uuid, function (err2) {
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
}


function deleteMachine(t) {
    CLIENT.del('/my/machines/' + MACHINE_UUID, function (err, req, res) {
        t.ifError(err, 'DELETE /my/machines error');
        t.equal(res.statusCode, 204, 'DELETE /my/machines status');
        t.end();
    });
}


function searchAndCheck(query, t, checkAttr) {
    CLIENT.get('/my/machines?' + query, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.ok(Array.isArray(body));
        t.ok(body.length > 0);

        body.forEach(function (m) {
            checkMachine(t, m);
            checkAttr(m);
        });

        t.end();
    });
}


function searchAndCheckOther(query, t, _checkAttr) {
    OTHER.get('/my/machines?' + query, function (err, req, res, body) {
        t.ifError(err);
        t.deepEqual(body, []);
        t.end();
    });
}


function checkTagDeleteValidationError(t, err, req, res, body) {
    t.ok(err);
    t.equal(err.restCode, 'ValidationFailed');
    t.equal(err.message, 'error deleting tag: Invalid tag parameters');
    t.equal(res.statusCode, 409);

    t.deepEqual(body, {
        code: 'ValidationFailed',
        message: 'error deleting tag: Invalid tag parameters',
        errors: [ {
            field: 'tags',
            code: 'Invalid',
            message: 'Special tag "docker:label:com.docker.blah" may not be ' +
                    'deleted'
        } ]
    });
}

function checkTagDeleteAllValidationError(t, err, req, res, body) {
    t.ok(err);
    t.equal(err.restCode, 'ValidationFailed');
    t.equal(err.message,
        'error deleting all tags: Invalid tag parameters');
    t.equal(res.statusCode, 409);

    t.deepEqual(body, {
        code: 'ValidationFailed',
        message: 'error deleting all tags: Invalid tag parameters',
        errors: [ {
            field: 'tags',
            code: 'Invalid',
            message: 'Special tag "docker:label:com.docker.blah" may not be ' +
                    'deleted'
        } ]
    });
}

function checkTagReplaceValidationError(t, err, req, res, body) {
    t.ok(err);
    t.equal(err.restCode, 'ValidationFailed');
    t.equal(err.message, 'error replacing tags: Invalid tag parameters');
    t.equal(res.statusCode, 409);

    t.deepEqual(body, {
        code: 'ValidationFailed',
        message: 'error replacing tags: Invalid tag parameters',
        errors: [ {
            field: 'tags',
            code: 'Invalid',
            message: 'Special tag "docker:label:com.docker.blah" may not be ' +
                    'deleted'
        } ]
    });
}
