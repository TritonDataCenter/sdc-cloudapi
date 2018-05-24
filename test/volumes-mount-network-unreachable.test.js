/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

var assert = require('assert-plus');
var test = require('@smaller/tap').test;
var util = require('util');
var vasync = require('vasync');

var common = require('./common');
var libuuid = require('libuuid');
var mod_config = require('../lib/config.js');
var mod_testConfig = require('./lib/config');
var mod_testNetworks = require('./lib/networks');
var mod_testVolumes = require('./lib/volumes');

var machinesCommon = require('./machines/common');

var CONFIG = mod_config.configure();
var DEFAULT_FABRIC_NETWORK_UUID;
var JOYENT_IMGAPI_SOURCE = 'https://images.joyent.com';
var NON_DEFAULT_FABRIC_VLAN_ID = 4;
var NON_DEFAULT_FABRIC_NETWORKS = [];
var TEST_IMAGE_SMARTOS = 'minimal-64-lts';
var TEST_SMARTOS_IMAGE_UUID;
var UFDS_ADMIN_UUID = CONFIG.ufds_admin_uuid;

function mountVolumeFromMachine(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.client, 'opts.client');
    assert.arrayOfUuid(opts.machineNetworkUuids, 'opts.machineNetworkuuids');
    assert.uuid(opts.machinePackageUuid, 'opts.machinePackageUuid');
    assert.arrayOfUuid(opts.volumeNetworkUuids, 'opts.volumeNetworkUuids');

    var client = opts.client;
    var machinePackageUuid = opts.machinePackageUuid;
    var shouldWaitForMachineDeletion = true;
    var shouldWaitForVolumeDeletion = true;
    var testMachineId;
    var testMachineName = 'sdc-cloudapi-tests-mount-network-unreachable-' +
        libuuid.create();
    var testVolumeId;
    var testVolumeName = 'sdc-cloudapi-tests-mount-network-unreachable-' +
        libuuid.create();

    vasync.pipeline({funcs: [
        function createVol(_, next) {
            client.post('/my/volumes', {
                name: testVolumeName,
                type: 'tritonnfs',
                networks: opts.volumeNetworkUuids
            }, function onVolumeCreated(volumeCreationErr, req, res, volume) {
                if (!volumeCreationErr && volume) {
                    testVolumeId = volume.id;
                }

                next(volumeCreationErr);
            });
        },
        function waitForVolumeReady(_, next) {
            var expectedState = 'ready';

            mod_testVolumes.waitForTransitionToState(client, testVolumeId,
                expectedState, function onTransition() {
                    CLIENT.get('/my/volumes/' + testVolumeId,
                        function onGetVolume(getVolumeErr, req, res, volume) {
                            if (!volume || volume.state !== expectedState) {
                                next(new Error('test volume not in expected ' +
                                    'state (' + expectedState + ')'));
                            } else {
                                next();
                            }
                        });
            });
        },
        function createMachine(_, next) {
            var payload;

            payload = {
                metadata: {},
                image: TEST_SMARTOS_IMAGE_UUID,
                package: machinePackageUuid,
                name: testMachineName,
                firewall_enabled: false,
                networks: opts.machineNetworkUuids,
                volumes: [
                    {
                        name: testVolumeName,
                        type: 'tritonnfs',
                        mode: 'rw',
                        mountpoint: '/foo'
                    }
                ]
            };

            CLIENT.post('/my/machines', payload,
                function machineCreated(machineCreateErr, req, res, body) {
                    if (machineCreateErr) {
                        next(machineCreateErr);
                        return;
                    }

                    if (!body) {
                        next(new Error('Empty body in response to ' +
                            'CreateMachine request'));
                        return;
                    }

                    testMachineId = body.id;

                    next();
                });
        },
        /*
         * We purposedly ignore errors when waiting for test machines to run, as
         * this is not what this specific tests suite is testing. Once a machine
         * is scheduled for provisioning, we already know whether or not the
         * validation of volume/machine networks allowed or prevented a machine
         * from being created. We just want to wait for the machine to be
         * created to be able to clean it up (delete it) afterwards.
         */
        function waitForMachineToRun(_, next) {
            machinesCommon.waitForRunningMachine(client, testMachineId,
                function waitDone(waitErr) {
                    next();
                });
        },
        function deleteMachine(_, next) {
            client.del('/my/machines/' + testMachineId, function onDel(delErr) {
                if (delErr) {
                    shouldWaitForMachineDeletion = false;
                }
                next();
            });
        },
        function waitMachineDeleted(_, next) {
            if (!shouldWaitForMachineDeletion) {
                next();
                return;
            }

            machinesCommon.waitForDeletedMachine(client, testMachineId,
                function onWaitDone(waitMachineErr) {
                    next();
                });
        },
        function deleteVolume(_, next) {
            client.del('/my/volumes/' + testVolumeId, function onDel(delErr) {
                if (delErr) {
                    shouldWaitForVolumeDeletion = false;
                }

                next();
            });
        },
        function waitVolumeDeleted(_, next) {
            if (!shouldWaitForVolumeDeletion) {
                next();
                return;
            }

            mod_testVolumes.waitForDeletion(client, testVolumeId,
                function onWaitDone(waitErr) {
                    next();
                });
        }
    ]}, cb);
}

if (CONFIG.experimental_cloudapi_nfs_shared_volumes !== true) {
    console.log('experimental_cloudapi_nfs_shared_volumes setting not ' +
        'enabled, skipping tests');
    process.exitCode = 0;
} else {
    var CLIENTS;
    var CLIENT;
    var SERVER;
    var SSH_PUBLIC_KEY;

    var testPackage;

    test('setup', function (t) {
        common.setup({clientApiVersion: '~8.0'}, function (_, clients, server) {
            CLIENTS = clients;
            CLIENT = clients.user;
            SERVER = server;

            t.end();
        });
    });

    // need a package we can use to provision our containers
    test('find usable package', function (t) {
        CLIENT.get('/my/packages',
            function onGetPackages(getPackageErr, req, res, packages) {
                t.ifErr(getPackageErr, 'getting packages should succeed');
                if (!getPackageErr) {
                    t.ok(Array.isArray(packages),
                        'packages should be an array');
                    t.ok(packages.length > 0,
                        'should have at least one package');

                    // choose the smallest package over 1024
                    packages.forEach(function choosePackage(pkg) {
                        if (pkg.memory >= 1024) {
                            if (testPackage === undefined) {
                                testPackage = pkg;
                                return;
                            }

                            if (pkg.memory < testPackage.memory) {
                                testPackage = pkg;
                            }
                        }
                    });

                    t.ok(testPackage && testPackage.id,
                        'should have found package, got: '
                        + JSON.stringify(testPackage));

                    t.end();
                }
            });
    });

    test('ensure SmartOS image', function (t) {
        common.makeImageProvisionable(CLIENT, TEST_IMAGE_SMARTOS,
            function onImgProvisionable(imgSetupErr, img) {
                t.ifErr(imgSetupErr, 'setting up images should not error');

                if (!imgSetupErr) {
                    TEST_SMARTOS_IMAGE_UUID = img.id;
                }

                t.end();
            });

    });

    /*
     * This is necessary so that we proceed with the rest of the tests suite
     * only after the entry for the newly added user (including its default
     * fabric network used to provision volumes) is present in UFDS.
     */
    test('getting config from ufds', function (t) {
        mod_testConfig.waitForAccountConfigReady(CLIENT,
            function onConfigReady(configReadyErr, ufdsConfig) {
                t.ifErr(configReadyErr, 'newly created user\'s config should ' +
                    'eventually be created');
                if (ufdsConfig) {
                    DEFAULT_FABRIC_NETWORK_UUID = ufdsConfig.default_network;
                }
                t.end();
            });
    });

    test('create fabric VLAN', function (t) {
        CLIENT.post('/my/fabrics/default/vlans', {
            name: 'sdccloudapi_tests_volumes_network_unreachable',
            description: 'test VLAN for sdc-cloudapi tests',
            vlan_id: NON_DEFAULT_FABRIC_VLAN_ID
        }, function vlanCreated(vlanCreateErr, req, res, body) {
            t.ifErr(vlanCreateErr, 'VLAN creation should be successful');
            t.end();
        });
    });

    test('create first non-default fabric network', function (t) {
        CLIENT.post(util.format('/my/fabrics/default/vlans/%d/networks',
            NON_DEFAULT_FABRIC_VLAN_ID), {
                name: 'sdccloudapitests_volumes_network_unreachable',
                provision_start_ip: '10.42.1.0',
                provision_end_ip: '10.42.255.254',
                resolvers: ['8.8.8.8'],
                subnet: '10.42.0.0/16'
            }, function onFabricNetCreated(fabricNetCreateErr, req, res, body) {
                t.ifError(fabricNetCreateErr,
                    'fabric network creation should be successful');
                if (body) {
                    NON_DEFAULT_FABRIC_NETWORKS.push(body.id);
                }
                t.end();
            });
    });

    test('create second non-default fabric network', function (t) {
        CLIENT.post(util.format('/my/fabrics/default/vlans/%d/networks',
            NON_DEFAULT_FABRIC_VLAN_ID), {
                name: 'sdccloudapitests_volumes_network_unreachable_2',
                provision_start_ip: '10.43.1.0',
                provision_end_ip: '10.43.255.254',
                resolvers: ['8.8.8.8'],
                subnet: '10.43.0.0/16'
            }, function onFabricNetCreated(fabricNetCreateErr, req, res, body) {
                t.ifError(fabricNetCreateErr,
                    'fabric network creation should be successful');
                if (body) {
                    NON_DEFAULT_FABRIC_NETWORKS.push(body.id);
                }
                t.end();
            });
    });

    test('volume on non-default-fabric, machine on default fabric',
        function (t) {
            mountVolumeFromMachine({
                client: CLIENT,
                machineNetworkUuids: [DEFAULT_FABRIC_NETWORK_UUID],
                machinePackageUuid: testPackage.id,
                volumeNetworkUuids: [NON_DEFAULT_FABRIC_NETWORKS[0]]
            }, function onMountDone(mountErr) {
                t.ok(mountErr, 'mounting volume on non-default fabric from ' +
                    'machine on default fabric should fail, got: ' + mountErr);
                t.end();
            });
        });

    test('volume on default-fabric, machine on non-default fabric',
    function (t) {
        mountVolumeFromMachine({
            client: CLIENT,
            machineNetworkUuids: [NON_DEFAULT_FABRIC_NETWORKS[0]],
            machinePackageUuid: testPackage.id,
            volumeNetworkUuids: [DEFAULT_FABRIC_NETWORK_UUID]
        }, function onMountDone(mountErr) {
            t.ok(mountErr, 'mounting volume on default fabric from machine ' +
                'on non-default fabric should fail, got: ' + mountErr);
            t.end();
        });
    });

    test('volume on non-default-fabric, machine on same non-default fabric',
        function (t) {
            mountVolumeFromMachine({
                client: CLIENT,
                machineNetworkUuids: [NON_DEFAULT_FABRIC_NETWORKS[0]],
                machinePackageUuid: testPackage.id,
                volumeNetworkUuids: [NON_DEFAULT_FABRIC_NETWORKS[0]]
            }, function onMountDone(mountErr) {
                t.ifError(mountErr, 'mounting volume on non-default fabric ' +
                    'from machine on same non-default fabric should succeed');
                t.end();
            });
        });

    test('volume on 2 non-default fabrics, machine on one of them',
        function (t) {
            mountVolumeFromMachine({
                client: CLIENT,
                machineNetworkUuids: [NON_DEFAULT_FABRIC_NETWORKS[0]],
                machinePackageUuid: testPackage.id,
                volumeNetworkUuids: [
                    NON_DEFAULT_FABRIC_NETWORKS[0],
                    NON_DEFAULT_FABRIC_NETWORKS[1]
                ]
            }, function onMountDone(mountErr) {
                t.ifError(mountErr, 'mounting volume on two non-default ' +
                    'fabric networks from machine on one of them should ' +
                    'succeed');
                t.end();
            });
        });

    test('machine on 2 non-default fabrics, volume on one of them',
        function (t) {
            mountVolumeFromMachine({
                client: CLIENT,
                machineNetworkUuids: [
                    NON_DEFAULT_FABRIC_NETWORKS[0],
                    NON_DEFAULT_FABRIC_NETWORKS[1]
                ],
                machinePackageUuid: testPackage.id,
                volumeNetworkUuids: [NON_DEFAULT_FABRIC_NETWORKS[0]]
            }, function onMountDone(mountErr) {
                t.ifError(mountErr, 'mounting volume on non-default fabric ' +
                    'network from machine on several networks including that ' +
                    'one should succeed');
                t.end();
            });
        });

    test('teardown', function (t) {
        common.teardown(CLIENTS, SERVER, function onTeardown(err) {
            t.ifErr(err, 'teardown should be successful, got: '
                + (err ? err.message : 'SUCCESS'));
            t.end();
        });
    });
}
