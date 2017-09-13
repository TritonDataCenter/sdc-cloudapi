/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var child_process = require('child_process');
var fs = require('fs');
var test = require('tape').test;
var vasync = require('vasync');
var verror = require('verror');

var common = require('./common');
var libuuid = require('libuuid');
var mod_config = require('../lib/config.js');
var mod_testConfig = require('./lib/config');
var mod_testNetworks = require('./lib/networks');
var mod_testVolumes = require('./lib/volumes');

var machinesCommon = require('./machines/common');

var CONFIG = mod_config.configure();
var IMGAPI_SOURCE = 'https://images.joyent.com';
var KEY_FILENAME = '/tmp/cloudapi-test-key';
var TEST_IMAGE_LX = '7b5981c4-1889-11e7-b4c5-3f3bdfc9b88b'; // ubuntu-16.04
var TEST_IMAGE_SMARTOS =
    'ede31770-e19c-11e5-bb6e-3b7de3cca9ce'; // minimal-multiarch-lts (15.4.1)
var UFDS_ADMIN_UUID = CONFIG.ufds_admin_uuid;

// XXX
TEST_IMAGE_SMARTOS = 'd0ebf524-2034-11e7-8e3d-878122f9de41';

function deleteKeypair(cb) {
    child_process.exec([
        'rm',
        '-f',
        KEY_FILENAME,
        KEY_FILENAME + '.pub'
    ].join(' '), function onKeyPairDeleted(err, stdout, stderr) {
        cb(err);
    });
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

    var fooContents;
    var lxIp;
    var lxVmUuid;
    var networkUuidFabric;
    var networkUuidSsh;
    var smartosIp;
    var smartosVmUuid;
    var testPackage;
    var testVolumeName = common.createResourceName('test-volumes-automount');
    var testVolume;
    var testVolumeStorageVmUuid;

    function getMissingImages(t, missing, callback) {
        if (missing.length === 0) {
            callback();
            return;
        }

        vasync.forEachParallel({
            func: function importOneImage(imgUuid, cb) {
                CLIENT.imgapi.adminImportRemoteImageAndWait(imgUuid,
                    IMGAPI_SOURCE, {}, cb);
            }, inputs: missing
        }, function (err, results) {
            callback(err);
        });
    }

    test('setup', function (t) {
        common.setup({clientApiVersion: '~8.0'}, function (_, clients, server) {
            CLIENTS = clients;
            CLIENT = clients.user;
            SERVER = server;

            t.end();
        });
    });

    /*
     * We need to provision on a network we can reach from cloudapi, so we use
     * the first non-admin NIC on this cloudapi instance. That way we know the
     * VM will be on the same network.
     */
    test('find external network', function (t) {
        child_process.execFile('/usr/sbin/mdata-get', ['sdc:nics'],
            function onExecOutput(execErr, stdout, stderr) {
                var idx;
                var nics;

                t.ifErr(execErr, 'should be able to load sdc:nics');
                nics = JSON.parse(stdout);

                for (idx = 0; idx < nics.length; idx++) {
                    if (networkUuidSsh === undefined &&
                        nics[idx].nic_tag !== 'admin') {

                        networkUuidSsh = nics[idx].network_uuid;
                    }
                }

                t.ok(networkUuidSsh, 'found external network: '
                    + networkUuidSsh);
                t.end();
            });
    });

    // need a package we can use to provision our containers
    test('find fabric network', function (t) {
        CLIENT.get('/my/networks',
            function onGetNetworks(getNetworksErr, req, res, networks) {
                t.ifErr(getNetworksErr, 'getting networks should succeed');
                if (!getNetworksErr) {
                    t.ok(Array.isArray(networks),
                        'networks should be an array');
                    t.ok(networks.length > 0,
                        'should have at least one network');
                    networks.forEach(function findFabric(net) {
                        if (networkUuidFabric === undefined &&
                            net.fabric === true) {

                            networkUuidFabric = net.id;
                        }
                    });

                    t.ok(networkUuidFabric, 'should have found fabric net, got:'
                        + ' ' + JSON.stringify(networkUuidFabric));

                    t.end();
                }
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

    // Ensure we have required images
    test('ensure images', function (t) {
        var foundLx = false;
        var foundSmartOS = false;
        var idx = 0;
        var missing = [];

        CLIENT.get('/my/images',
            function onGetImages(getImagesErr, req, res, images) {
                t.ifErr(getImagesErr, 'getting images should succeed');

                if (!getImagesErr) {
                    t.ok(Array.isArray(images),
                        'images should be an array');
                    t.ok(images.length >= 2,
                        'should have at least two images');
                }

                for (idx = 0; idx < images.length; idx++) {
                    if (images[idx].id === TEST_IMAGE_LX) {
                        foundLx = true;
                    }
                    if (images[idx].id === TEST_IMAGE_SMARTOS) {
                        foundSmartOS = true;
                    }
                }

                if (!foundLx) {
                    missing.push(TEST_IMAGE_LX);
                }

                if (!foundSmartOS) {
                    missing.push(TEST_IMAGE_SMARTOS);
                }

                getMissingImages(t, missing, function (getMissingErr) {
                    t.ifErr(getMissingErr,
                        'should have succeeded to get missing images');
                    t.end();
                });
            });
    });

    // delete previous SSH keypair(s)
    test('delete previous SSH keypair', function (t) {
        deleteKeypair(function onDeleted(err) {
            t.ifErr(err, 'removing keypair should succeed');
            t.end();
        });
    });

    // create an SSH keypair so we can use that to SSH into the test zone we're
    // going to create.
    test('create an SSH keypair', function (t) {
        child_process.exec([
            'ssh-keygen',
            '-t rsa',
            '-N ""',
            '-f',
            KEY_FILENAME
        ].join(' '), function onKeyPairCreated(err, stdout, stderr) {
            t.ifErr(err, 'ssh-keygen should succeed');

            fs.readFile(KEY_FILENAME + '.pub',
                function onReadKey(readErr, keyData) {
                    t.ifErr(readErr, 'reading public key should succeed');
                    SSH_PUBLIC_KEY = keyData.toString().trim();
                    t.ok(SSH_PUBLIC_KEY, 'should have found pubic key, got: ' +
                        SSH_PUBLIC_KEY.substr(0, 20) + '...' +
                        SSH_PUBLIC_KEY.substr(SSH_PUBLIC_KEY.length - 20));
                    t.end();
                });

        });
    });

    /*
     * This is necessary so that we proceed with the rest of the tests suite
     * only after the entry for the newly added user (including its default
     * fabric network used to provision volumes) is present in UFDS.
     */
    test('getting config from ufds', function (t) {
        mod_testConfig.waitForAccountConfigReady(CLIENT,
            function onConfigReady(configReadyErr) {
                t.ifErr(configReadyErr, 'newly created user\'s config should ' +
                    'eventually be created');
                t.end();
            });
    });

    test('creating volume with default params should be successful',
        function (t) {
            CLIENT.post('/my/volumes', {
                name: testVolumeName,
                type: 'tritonnfs'
            }, function onVolumeCreated(volumeCreationErr, req, res, volume) {
                testVolume = volume;

                t.ifErr(volumeCreationErr,
                    'creating a volume with default parameters should not ' +
                        'error');
                t.ok(volume.id, 'new volume has uuid: ' + volume.id);
                t.end();
            });
    });

    test('volume should eventually transition to state \'ready\'',
        function (t) {
            var expectedState = 'ready';

            mod_testVolumes.waitForTransitionToState(CLIENT, testVolume.id,
                expectedState, function onTransition() {
                    CLIENT.get('/my/volumes/' + testVolume.id,
                        function onGetVolume(getVolumeErr, req, res, volume) {
                            t.ifErr(getVolumeErr,
                                'getting newly created volume should not ' +
                                    'error');
                            t.ok(typeof (volume) === 'object' &&
                                volume !== null,
                                    'response should be a non-null object');
                            t.equal(volume.name, testVolumeName,
                                'volume name should be \'' + testVolumeName +
                                    '\'');
                            t.equal(volume.state, expectedState,
                                'volume should have transitioned to state \'' +
                                    expectedState + '\'');

                            t.end();
                        });
            });
    });

    test('create an LX container using volume', function (t) {
        var payload;

        payload = {
            metadata: {},
            image: TEST_IMAGE_LX,
            package: testPackage.id,
            name: 'cloudapi-volume-lx-' + libuuid.create().split('-')[0],
            firewall_enabled: false,
            networks: [
                {ipv4_uuid: networkUuidSsh, primary: true},
                {ipv4_uuid: networkUuidFabric}
            ],
            volumes: [
                {
                    name: testVolumeName,
                    type: 'tritonnfs',
                    mode: 'rw',
                    mountpoint: '/foo'
                }
            ]
        };

        payload['metadata.user-script'] = [
            '#!/bin/bash',
            '',
            'cat > /root/.ssh/authorized_keys <<EOF',
            SSH_PUBLIC_KEY,
            'EOF',
            'chmod 0700 /root/.ssh',
            'chmod 0600 /root/.ssh/authorized_keys'
        ].join('\n');

        CLIENT.post('/my/machines', payload, function (err, req, res, body) {
            t.ifErr(err, 'expect VM create success');

            if (!err) {
                lxVmUuid = body.id;
                t.ok(lxVmUuid, 'New VM\'s UUID is ' + lxVmUuid);
            }

            t.end();
        });
    });

    // Wait for container
    test('waiting for container to go to "running"', function (t) {
        machinesCommon.waitForRunningMachine(CLIENT, lxVmUuid,
            function (err) {
                t.ifError(err, 'waitForRunningMachine ' + lxVmUuid);
                t.end();
            });
    });

    // Get the container IP
    test('get container IP', function (t) {
        CLIENT.get('/my/machines/' + lxVmUuid,
            function onGetMachine(getMachineErr, req, res, machine) {
                t.ifErr(getMachineErr, 'getting machine should succeed');

                if (!getMachineErr && machine) {
                    t.ok(machine.primaryIp, 'should have primaryIp, got: '
                        + machine.primaryIp);
                    lxIp = machine.primaryIp;
                }

                t.end();
            });
    });

    // write a file
    test('write a file to volume from LX', function (t) {
        fooContents = 'hello from ' + lxVmUuid;
        child_process.execFile('/usr/bin/ssh', [
            '-i', KEY_FILENAME,
            '-o StrictHostKeyChecking=no',
            '-o LogLevel=ERROR',
            '-o UserKnownHostsFile=/dev/null',
            'root@' + lxIp,
            'echo "' + fooContents + '" > /foo/fooFile'
        ], function onExecOutput(execErr, stdout, stderr) {
            t.ifErr(execErr, 'write to file should succeed');

            t.equal(stderr, '', 'stderr should be empty');

            t.end();
        });
    });

    test('deleting LX container should be successful', function (t) {
        CLIENT.del('/my/machines/' + lxVmUuid,
            function onDelVm(delVmErr) {
                t.ifErr(delVmErr, 'deleting LX VM should succeed');
                t.end();
            });
    });

    // since restify clients don't allow us to get the DELETE body so that we
    // could poll the job, we'll just poll the VM's state.
    test('wait for container to be deleted', function (t) {
        var attempt = 0;
        var state;

        function getState() {
            CLIENT.get('/my/machines/' + lxVmUuid,
                function onGetMachine(getMachineErr, req, res, machine) {
                    // 410 means the VM was deleted
                    if (getMachineErr) {
                        if (getMachineErr.statusCode === 410 &&
                            machine && machine.state === 'deleted') {

                            // pretend like restify knows how to handle this
                            getMachineErr = undefined;
                        } else {
                            t.ifErr(getMachineErr,
                                'getting machine should succeed');
                        }
                    }

                    if (!getMachineErr && machine) {
                        attempt++;
                        t.ok(machine.state, 'should have state, got: '
                            + machine.state + ' (try ' + attempt + ')');
                        state = machine.state;
                        if (state === 'deleted') {
                            t.end();
                        } else {
                            setTimeout(getState, 5000);
                        }
                    } else {
                        t.end();
                    }
                });
        }

        getState();
    });

    test('create a SmartOS container using volume', function (t) {
        var payload;

        payload = {
            metadata: {},
            image: TEST_IMAGE_SMARTOS,
            package: testPackage.id,
            name: 'cloudapi-volume-smartos-' + libuuid.create().split('-')[0],
            firewall_enabled: false,
            networks: [
                {ipv4_uuid: networkUuidSsh, primary: true},
                {ipv4_uuid: networkUuidFabric}
            ],
            volumes: [
                {
                    name: testVolumeName,
                    type: 'tritonnfs',
                    mode: 'rw',
                    mountpoint: '/foo'
                }
            ]
        };

        payload['metadata.user-script'] = [
            '#!/bin/bash',
            '',
            'cat > /root/.ssh/authorized_keys <<EOF',
            SSH_PUBLIC_KEY,
            'EOF',
            'chmod 0700 /root/.ssh',
            'chmod 0600 /root/.ssh/authorized_keys'
        ].join('\n');

        CLIENT.post('/my/machines', payload, function (err, req, res, body) {
            t.ifErr(err, 'expect VM create success');

            if (!err) {
                smartosVmUuid = body.id;
                t.ok(smartosVmUuid, 'New VM\'s UUID is ' + smartosVmUuid);
            }

            t.end();
        });
    });

    // Wait for container
    test('waiting for container to go to "running"', function (t) {
        machinesCommon.waitForRunningMachine(CLIENT, smartosVmUuid,
            function (err) {
                t.ifError(err, 'waitForRunningMachine ' + smartosVmUuid);
                t.end();
            });
    });

    // Get the container IP
    test('get container IP', function (t) {
        CLIENT.get('/my/machines/' + smartosVmUuid,
            function onGetMachine(getMachineErr, req, res, machine) {
                t.ifErr(getMachineErr, 'getting machine should succeed');

                if (!getMachineErr && machine) {
                    t.ok(machine.primaryIp, 'should have primaryIp, got: '
                        + machine.primaryIp);
                    smartosIp = machine.primaryIp;
                }

                t.end();
            });
    });

    // write a file
    test('read the file created by LX container', function (t) {
        child_process.execFile('/usr/bin/ssh', [
            '-i', KEY_FILENAME,
            '-o StrictHostKeyChecking=no',
            '-o LogLevel=ERROR',
            '-o UserKnownHostsFile=/dev/null',
            'root@' + smartosIp,
            'cat /foo/fooFile'
        ], function onExecOutput(execErr, stdout, stderr) {
            t.ifErr(execErr, 'write to file should succeed');

            t.equal(stdout.trim(), fooContents,
                '/foo/fooFile should have expected contents');
            t.equal(stderr, '', 'stderr should be empty');

            t.end();
        });
    });

    test('deleting SmartOS container should be successful', function (t) {
        CLIENT.del('/my/machines/' + smartosVmUuid,
            function onDelVm(delVmErr) {
                t.ifErr(delVmErr, 'deleting LX VM should succeed');
                t.end();
            });
    });

    // since restify clients don't allow us to get the DELETE body so that we
    // could poll the job, we'll just poll the VM's state.
    test('wait for container to be deleted', function (t) {
        var attempt = 0;
        var state;

        function getState() {
            CLIENT.get('/my/machines/' + smartosVmUuid,
                function onGetMachine(getMachineErr, req, res, machine) {
                    // 410 means the VM was deleted
                    if (getMachineErr) {
                        if (getMachineErr.statusCode === 410 &&
                            machine && machine.state === 'deleted') {

                            // pretend like restify knows how to handle this
                            getMachineErr = undefined;
                        } else {
                            t.ifErr(getMachineErr,
                                'getting machine should succeed');
                        }
                    }

                    if (!getMachineErr && machine) {
                        attempt++;
                        t.ok(machine.state, 'should have state, got: '
                            + machine.state + ' (try ' + attempt + ')');
                        state = machine.state;
                        if (state === 'deleted') {
                            t.end();
                        } else {
                            setTimeout(getState, 5000);
                        }
                    } else {
                        t.end();
                    }
                });
        }

        getState();
    });

    test('deleting volume should be successful', function (t) {
        CLIENT.del('/my/volumes/' + testVolume.id,
            function onDelVolume(delVolumeErr) {
                t.ifErr(delVolumeErr,
                    'deleting newly created volume should not error');
                t.end();
            });
    });

    test('volume should eventually disappear', function (t) {
        mod_testVolumes.waitForDeletion(CLIENT, testVolume.id,
            function onDeleted() {
                CLIENT.get('/my/volumes/' + testVolume.id,
                    function onGetVolume(getVolumeErr) {
                        t.ok(verror.hasCauseWithName(getVolumeErr,
                            'VolumeNotFoundError'), 'expected ' +
                            'VolumeNotFoundError error, got: ' +
                            (getVolumeErr ? getVolumeErr.name :
                            JSON.stringify(getVolumeErr)));

                        t.end();
                });
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
