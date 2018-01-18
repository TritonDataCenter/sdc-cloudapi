/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

var test = require('tape').test;
var libuuid = require('libuuid');
var util = require('util');
var vasync = require('vasync');

var common = require('./common');
var machinesCommon = require('./machines/common');
var waitForJob = machinesCommon.waitForJob; // XXX


// --- Globals

var format = util.format;

var CLIENTS;
var CLIENT;
var SERVER;

// --- Helpers

// --- Tests

test('image creation', function (tt) {
    var testInstId;
    var testOriginId;
    var testNamePrefix = 'sdccloudapitest_images_create_'
        + libuuid.create().split('-')[0] + '_';
    var testImg1Id;
    var testImg2Id;
    var testImg3Id;

    tt.test('  setup clients', function (t) {
        common.setup({clientApiTestVersion: '~9'},
                function (_, clients, server) {
            CLIENTS = clients;
            CLIENT  = clients.user;
            SERVER  = server;

            t.end();
        });
    });

    tt.test('  setup test inst', function (t) {
        vasync.pipeline({arg: {}, funcs: [
            function testOriginImg(ctx, next) {
                common.getTestImage(CLIENT, function (err, img) {
                    t.ifError(err, 'getTestImage');
                    ctx.img = img;
                    testOriginId = img.id;
                    next(err);
                });
            },

            function testServer(ctx, next) {
                common.getTestServer(CLIENT, function (err, server) {
                    t.ifError(err, 'getTestServer');
                    ctx.server = server;
                    next(err);
                });
            },

            function createInst(ctx, next) {
                var createOpts = {
                    image: ctx.img.id,
                    package: common.sdc_128_package.name,
                    name: testNamePrefix + 'inst',
                    server_uuid: ctx.server.uuid
                };
                machinesCommon.createMachine(t, CLIENT, createOpts,
                        function (err, instId) {
                    t.ifError(err, 'createTestInst');
                    ctx.instId = instId;
                    t.ok(instId, 'test inst id: ' + instId);
                    next(err);
                });
            },

            function waitForInst(ctx, next) {
                machinesCommon.waitForRunningMachine(CLIENT, ctx.instId,
                        function (err) {
                    t.ifError(err, 'waitForRunningMachine ' + ctx.instId);
                    if (!err) {
                        testInstId = ctx.instId;
                    }
                    next(err);
                });
            }
        ]}, function doneSetupTestInst(err) {
            t.ifError(err, 'setup test inst');
            t.end();
        });
    });

    // As of CloudAPI v9 this should default to a non-incremental build.
    tt.test('  create image1 (latest API version)', function (t) {
        var name = testNamePrefix + 'image1';
        var createOpts = {
            machine: testInstId,
            name: name,
            version: '1.0.0'
        };
        CLIENT.post('/my/images', createOpts, function (err, req, res, img) {
            t.ifError(err, 'create image ' + name + ' err');
            t.ok(img.name, 'image name: ' + img.name);
            t.ok(img.id, 'image id: ' + img.id);
            testImg1Id = img.id;
            t.end();
        });
    });
    tt.test('  wait for and check image1', function (t) {
        common.waitForImageCreate(CLIENT, testImg1Id, function (err, img) {
            t.ifError(err, 'wait for image1 ' + testImg1Id + ' create');
            t.ok(img, 'created image manifest');
            if (img) {
                t.equal(img.state, 'active', format(
                    'image1 %s state is active: %s', testImg1Id, img.state));
                t.equal(img.origin, undefined, format(
                    'image1 %s has *no* origin', testImg1Id));
            }
            t.end();
        });
    });

    // With ?incremental=true we should get an incremental image.
    tt.test('  create image2 (specify incremental)', function (t) {
        var name = testNamePrefix + 'image2';
        var createOpts = {
            machine: testInstId,
            name: name,
            version: '1.0.0',
            incremental: true
        };
        CLIENT.post('/my/images', createOpts, function (err, req, res, img) {
            t.ifError(err, 'create image ' + name + ' err');
            t.ok(img.name, 'image name: ' + img.name);
            t.ok(img.id, 'image id: ' + img.id);
            testImg2Id = img.id;
            t.end();
        });
    });
    tt.test('  wait for and check image2', function (t) {
        common.waitForImageCreate(CLIENT, testImg2Id, function (err, img) {
            t.ifError(err, 'wait for image2 ' + testImg2Id + ' create');
            t.ok(img, 'created image manifest');
            if (img) {
                t.equal(img.state, 'active', format(
                    'image2 %s state is active: %s', testImg2Id, img.state));
                t.equal(img.origin, testOriginId, format(
                    'image2 %s has the expected origin: %s', testImg2Id,
                    img.origin));
            }
            t.end();
        });
    });

    // CloudAPI v8 and earlier, the default was incremental images.
    tt.test('  create image3 (API version 8)', function (t) {
        var name = testNamePrefix + 'image3';
        var createOpts = {
            machine: testInstId,
            name: name,
            version: '1.0.0'
        };

        CLIENT.post({
            path: '/my/images',
            headers: {
                'accept-version': '~8'
            }
        }, createOpts, function (err, req, res, img) {
            t.ifError(err, 'create image ' + name + ' err');
            t.ok(img.name, 'image name: ' + img.name);
            t.ok(img.id, 'image id: ' + img.id);
            testImg3Id = img.id;
            t.end();
        });
    });
    tt.test('  wait for and check image3', function (t) {
        common.waitForImageCreate(CLIENT, testImg3Id, function (err, img) {
            t.ifError(err, 'wait for image3 ' + testImg3Id + ' create');
            t.ok(img, 'created image manifest');
            if (img) {
                t.equal(img.state, 'active', format(
                    'image3 %s state is active: %s', testImg3Id, img.state));
                t.equal(img.origin, testOriginId, format(
                    'image3 %s has the expected origin: %s', testImg3Id,
                    img.origin));
            }
            t.end();
        });
    });

    tt.test('  delete image1, image2, and image3', function (t) {
        vasync.forEachParallel({
            inputs: [testImg1Id, testImg2Id, testImg3Id],
            func: function deleteOneTestImg(imgId, next) {
                if (!imgId) {
                    next();
                    return;
                }
                CLIENT.del('/my/images/' + imgId, function (err, req, res) {
                    t.ifError(err, format('delete test image %s (req_id=%s)',
                        imgId, res.headers['request-id']));
                    next();
                });
            }
        }, function (err) {
            t.ifError(err, 'delete test images');
            t.end();
        });
    });

    tt.test('  delete test inst', function (t) {
        if (!testInstId) {
            t.end();
            return;
        }
        CLIENT.del('/my/machines/' + testInstId, function (err, req, res) {
            t.ifError(err, format('delete test inst %s (req_id=%s)',
                testInstId, res.headers['request-id']));
            t.end();
        });
    });

    tt.test('  teardown clients', function (t) {
        common.teardown(CLIENTS, SERVER, function (err) {
            t.ifError(err, 'teardown success');
            t.end();
        });
    });
});
