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
var JOYENT_IMGAPI_SOURCE = 'https://images.joyent.com';
var KEY_FILENAME = '/tmp/cloudapi-test-key';
/*
 * The test images below are imported via sdcadm post-setup dev-sample-data.
 */
var TEST_IMAGE_KVM = 'ubuntu-certified-16.04';
var TEST_IMAGE_LX = 'ubuntu-16.04';
var TEST_IMAGE_NAMES_TO_UUID = {};
var TEST_IMAGE_SMARTOS = 'minimal-64-lts';
var UFDS_ADMIN_UUID = CONFIG.ufds_admin_uuid;

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

/*
 * Make the image with name "imageName" provisionable. If it's imported and not
 * public, it makes the image public.
 *
 * @params {String} imageName (required): the name of the image to make
 *   provisionable
 * @params {Function} callback (required): called at the end of the process as
 *   callback(err, provisionableImgObject)
 *
 * where "provisionableImgObject" represents an image with an "id" property that
 * stores its UUID.
 */
function makeImageProvisionable(imageName, callback) {
    assert.string(imageName, 'imageName');
    assert.func(callback, 'callback');

    var context = {};

    vasync.pipeline({arg: context, funcs: [
        function listImportedImages(ctx, next) {
            CLIENT.get('/my/images?name=' + imageName,
                function onListImportedImages(listImagesErr, req, res, images) {
                    var err = listImagesErr;

                    if (!images || images.length === 0) {
                        err = new Error('Could not find image with name: ' +
                            imageName);
                    }

                    ctx.images = images;
                    next(err);
                });

        },
        /*
         * When images are imported into a DC's IMGAPI because they're an origin
         * image for another image imported from updates.joyent.com, their
         * "public" attribute is set to false, which makes them
         * non-provisionable. In this case, we just update that public property
         * to "true".
         */
        function ensureOneImportedImgIsPublic(ctx, next) {
            var firstImage;
            var publicImages;

            assert.optionalArrayOfObject(ctx.images, 'ctx.images');

            if (ctx.images && ctx.images.length > 0) {
                publicImages = ctx.images.filter(function isPublic(image) {
                    return image.public;
                });

                if (publicImages.length > 0) {
                    ctx.provisionableImage = publicImages[0];
                    next();
                } else {
                    firstImage = ctx.images[0];
                    firstImage.public = true;
                    CLIENT.imgapi.updateImage(firstImage.uuid, firstImage,
                        CLIENT.account.uuid,
                        function onImageUpdated(updateImgErr) {
                            if (updateImgErr) {
                                next(updateImgErr);
                                return;
                            }

                            ctx.provisionableImage = firstImage;
                            next();
                        });
                }
            } else {
                next();
            }
        }
    ]}, function onAllDone(err) {
        callback(err, context.provisionableImage);
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
    var lxVmDelErr;
    var lxVmUuid;
    var networkUuidFabric;
    var networkUuidSsh;
    var smartosIp;
    var smartosVmDelErr;
    var smartosVmUuid;
    var testPackage;
    var testVolumeName = 'test-volumes-automount';
    var testVolume;
    var testVolumeStorageVmUuid;

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

    /*
     * Need a fabric network we can use to provision our containers for the NFS
     * traffic to flow.
     */
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
        var IMG_NAMES = [TEST_IMAGE_LX, TEST_IMAGE_KVM, TEST_IMAGE_SMARTOS];

        vasync.forEachParallel({
            func: makeImageProvisionable,
            inputs: IMG_NAMES
        }, function onAllImgsSetupDone(imgsSetupErr, results) {
            var idx;

            t.ifErr(imgsSetupErr, 'setting up images should not error');

            if (!imgsSetupErr) {
                t.ok(results.successes,
                    'result of making images provisionable should be present');
                if (results.successes) {
                    t.equal(results.successes.length, IMG_NAMES.length,
                        'made ' + IMG_NAMES.length + ' images provisionable');
                    for (idx = 0; idx < results.successes.length; ++idx) {
                        TEST_IMAGE_NAMES_TO_UUID[results.successes[idx].name] =
                            results.successes[idx].id;
                    }
                }
            }

            t.end();
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
            image: TEST_IMAGE_NAMES_TO_UUID[TEST_IMAGE_LX],
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
                lxVmDelErr = delVmErr;
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

        if (lxVmDelErr) {
            t.fail('DeleteVm request failed, so there is no point in waiting ' +
                'for the container to be deleted');
            t.end();
        } else if (lxVmUuid === undefined) {
            t.fail('LX container was not provisioned, marking test as failed ' +
                'because it is not relevant to delete a container that was ' +
                'not created');
            t.end();
        } else {
            getState();
        }
    });

    test('create a SmartOS container using volume', function (t) {
        var payload;

        payload = {
            metadata: {},
            image: TEST_IMAGE_NAMES_TO_UUID[TEST_IMAGE_SMARTOS],
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
                smartosVmDelErr = delVmErr;
                t.ifErr(delVmErr, 'deleting SmartOS VM should succeed');
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

        if (smartosVmUuid === undefined) {
            t.fail('No SmartOS VM UUID, so there is no point in trying to ' +
                'delete it');
            t.end();
        } else if (smartosVmDelErr) {
            t.fail('Error when sending DeleteVM request, so there is no ' +
                'point in waiting for the VM to be deleted');
            t.end();
        } else {
            getState();
        }
    });

    test('creating a KVM container using volume should fail', function (t) {
        var payload;

        payload = {
            metadata: {},
            image: TEST_IMAGE_NAMES_TO_UUID[TEST_IMAGE_KVM],
            package: testPackage.id,
            name: 'cloudapi-volume-kvm-' + libuuid.create().split('-')[0],
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

        CLIENT.post('/my/machines', payload, function (err, req, res, body) {
            t.ok(err, 'expect VM create failure');
            t.equal(err.statusCode, 409, 'expected 409');
            t.equal(err.message, 'volumes not yet supported with brand "kvm"',
                'expected error due to unsupported kvm');

            t.end();
        });
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
