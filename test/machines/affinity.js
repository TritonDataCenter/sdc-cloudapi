/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019, Joyent, Inc.
 */

var clone = require('clone');
var libuuid = require('libuuid');
var machinesCommon = require('./common');


// --- Globals

var CONTAINER_PREFIX = 'sdccloudapitest_affinity_';


// --- Tests

module.exports =
function (suite, client, other, imgUuid, pkgUuid, headnodeUuid, cb) {
    var VM_UUID;
    var VM2_UUID;


    function createArgs(affinity) {
        return {
            image: imgUuid,
            package: pkgUuid,
            name: CONTAINER_PREFIX + libuuid.create().split('-')[0],
            server_uuid: headnodeUuid,
            firewall_enabled: true,
            affinity: [affinity]
        };
    }

    function checkFail(t, _client, affinityStr) {
        var args = createArgs(affinityStr);

        _client.post('/my/machines', args, function postCb(err, req, res, vm) {
            t.ok(err, 'err');
            t.equal(err.name, 'NoAllocatableServersError');
            t.end();
        });
    }


    // this should fail due to bad syntax
    suite.test('CreateMachine with bad-syntax affinity', function (t) {
        var args = createArgs('container=!' + CONTAINER_PREFIX + '*');

        client.post('/my/machines', args, function postCb(err, req, res, vm) {
            t.ok(err, 'err');
            t.ok(/not find operator in affinity/.test(err.message), 'err.msg');
            t.equal(res.statusCode, 409);
            t.end();
        });
    });


    // This should fail: no container with name 'sdccloudapitest_affinity_*'.
    suite.test('CreateMachine with affinity "container==' + CONTAINER_PREFIX +
        '*"', function (t) {
        checkFail(t, client, 'container==' + CONTAINER_PREFIX + '*');
    });


    // This should fail: no instance (different name for container) with name
    // 'sdccloudapitest_affinity_*'.
    suite.test('CreateMachine with affinity "instance==' + CONTAINER_PREFIX +
        '*"', function (t) {
        checkFail(t, client, 'instance==' + CONTAINER_PREFIX + '*');
    });


    // Same as above, but using a regular expression
    suite.test('CreateMachine with affinity "container==/^' + CONTAINER_PREFIX +
        '/"', function (t) {
        checkFail(t, client, 'container==/^' + CONTAINER_PREFIX + '/');
    });


    // This should work: no container with name 'sdccloudapitest_affinity_*'.
    // This behaviour was changed in DAPI-306.
    suite.test('CreateMachine with affinity "container!=' + CONTAINER_PREFIX +
        '*"', function (t) {

        var args = createArgs('container!=' + CONTAINER_PREFIX + '*');

        client.post('/my/machines', args, function (err, req, res, vm) {
            t.ifError(err, 'VM affinity should succeed');
            t.ok(vm, 'VM should be created');

            VM_UUID = vm.id;

            t.end();
        });
    });


    suite.test('Wait for running, then clean up', function (t) {
        machinesCommon.waitForRunningMachine(client, VM_UUID, function (err) {
            t.ifError(err);

            client.del('/my/machines/' + VM_UUID, function (err2, req, res) {
                t.ifError(err2, 'Cleanup test container');

                machinesCommon.waitForDeletedMachine(client, VM_UUID,
                function waitCb(err3) {
                    t.ifError(err3, 'Wait for deletion');
                    t.end();
                });
            });
        });
    });


    // same as above test, but with instance
    suite.test('CreateMachine with affinity "instance!=' + CONTAINER_PREFIX +
        '*"', function (t) {

        var args = createArgs('instance!=' + CONTAINER_PREFIX + '*');

        client.post('/my/machines', args, function (err, req, res, vm) {
            t.ifError(err, 'VM affinity should succeed');
            t.ok(vm, 'VM should be created');

            VM_UUID = vm.id;

            t.end();
        });
    });


    suite.test('Wait for running, then clean up', function (t) {
        machinesCommon.waitForRunningMachine(client, VM_UUID, function (err) {
            t.ifError(err);

            client.del('/my/machines/' + VM_UUID, function (err2, req, res) {
                t.ifError(err2, 'Cleanup test container');

                machinesCommon.waitForDeletedMachine(client, VM_UUID,
                function waitCb(err3) {
                    t.ifError(err3, 'Wait for deletion');
                    t.end();
                });
            });
        });
    });


    // This should fail: no container with label foo=bar2.
    suite.test('CreateMachine with affinity "foo==bar2"', function (t) {
        checkFail(t, client, 'foo==bar2');
    });


    // This should work: no container with label foo=bar2, but *soft* affinity.
    suite.test('CreateMachine with affinity "foo==~bar2"', function (t) {
        var args = createArgs('foo==~bar2');

        client.post('/my/machines', args, function (err, req, res, vm) {
            t.ifError(err, 'VM affinity should succeed');
            t.ok(vm, 'VM should be created');

            VM_UUID = vm.id;

            t.end();
        });
    });


    suite.test('Wait for running, then clean up', function (t) {
        machinesCommon.waitForRunningMachine(client, VM_UUID, function (err) {
            t.ifError(err);

            client.del('/my/machines/' + VM_UUID, function (err2, req, res) {
                t.ifError(err2, 'Cleanup test container');

                machinesCommon.waitForDeletedMachine(client, VM_UUID,
                function waitCb(err3) {
                    t.ifError(err3, 'Wait for deletion');
                    t.end();
                });
            });
        });
    });


    // This should work: no container with label foo=bar1.
    suite.test('CreateMachine with affinity "foo!=bar1"', function (t) {
        var args = createArgs('foo!=bar1');
        args['tag.foo'] = 'bar2';

        client.post('/my/machines', args, function (err, req, res, vm) {
            t.ifError(err, 'VM affinity should succeed');
            t.ok(vm, 'VM should be created');

            VM_UUID = vm.id;

            t.end();
        });
    });


    suite.test('Wait for running', function (t) {
        machinesCommon.waitForRunningMachine(client, VM_UUID, function (err) {
            t.ifError(err);
            t.end();
        });
    });


    // Now this one should work: we *do* have a container with label foo=bar2
    // (created in previous step).
    suite.test('CreateMachine with affinity "foo==bar2"', function (t) {
        var args = createArgs('foo==bar2');

        client.post('/my/machines', args, function (err, req, res, vm) {
            t.ifError(err, 'VM affinity should succeed');
            t.ok(vm, 'VM should be created');

            VM2_UUID = vm.id;

            t.end();
        });
    });


    suite.test('Wait for running, then clean up', function (t) {
        machinesCommon.waitForRunningMachine(client, VM2_UUID, function (err) {
            t.ifError(err);

            client.del('/my/machines/' + VM2_UUID, function (err2, req, res) {
                t.ifError(err2, 'Cleanup test container');

                machinesCommon.waitForDeletedMachine(client, VM2_UUID,
                function waitCb(err3) {
                    t.ifError(err3, 'Wait for deletion');
                    t.end();
                });
            });
        });
    });


    suite.test('Clean up remaining test container', function (t) {
        client.del('/my/machines/' + VM_UUID, function (err, req, res) {
            t.ifError(err, 'Cleanup test container');
            t.end();
        });
    });


    return cb();
};
