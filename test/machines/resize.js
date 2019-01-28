/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

var common = require('../common');
var vasync = require('vasync');
var waitForJob = require('./common').waitForJob;

var uuid = common.uuid;
var checkNotFound = common.checkNotFound;


// --- Tests


module.exports =
function (suite, client, other, machine, pkgDown, pkgSame, pkgUp, cb) {
    if (!machine) {
        return cb();
    }

    suite.test('Resize Machine up on coal', function (t) {
        t.ok(pkgUp, 'Resize up package OK');

        if (!common.getCfg().datacenters.coal) {
            return t.end();
        }

        return client.post('/my/machines/' + machine, {
            action: 'resize',
            'package': pkgUp.uuid
        }, function (err) {
            t.ok(err);

            var body = err.body;
            t.ok(body);

            if (body) {
                t.equal(body.code, 'ValidationFailed');
                t.equal(body.message, 'Invalid VM update parameters');

                t.equal(body.errors.length, 1);
                var error = body.errors[0];

                t.equal(error.field, 'ram');
                t.equal(error.code, 'InsufficientCapacity');
            }

            t.end();
        });
    });


    suite.test('Resize Machine to same package - other', function (t) {
        t.ok(pkgSame, 'Resize same package OK');

        other.post('/my/machines/' + machine, {
            action: 'resize',
            'package': pkgSame.uuid
        }, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('Resize Machine to same package', function (t) {
        t.ok(pkgSame, 'Resize same package OK: package ' + pkgSame.name);

        client.post('/my/machines/' + machine, {
            action: 'resize',
            'package': pkgSame.uuid
        }, function (err) {
            t.ifError(err, 'Resize machine error');
            t.end();
        });
    });


    suite.test('Wait For Resized to same', function (t) {
        waitAndCheckResize(t, pkgSame);
    });

    suite.test('Resize Machine down', function (t) {
        t.ok(pkgDown, 'Resize down package OK: package ' + pkgDown.name);

        client.post('/my/machines/' + machine, {
            action: 'resize',
            'package': pkgDown.uuid
        }, function (err) {
            t.ifError(err, 'Resize machine error');
            t.end();
        });
    });

    suite.test('Wait For Resized to down', function (t) {
        waitAndCheckResize(t, pkgDown);
    });

    suite.test('Resize with private image (docker)', function (t) {
        var imgapi = client.imgapi;
        var img;

        function getImage(ctx, next) {
            client.vmapi.getVm({ uuid: machine }, function onGetVm(err, vm) {
                t.ifError(err, 'GetVm error');

                imgapi.getImage(vm.image_uuid, function onGetImage(err2, _img) {
                    t.ifError(err2, 'GetImage error');
                    img = _img;
                    next(err);
                });
            });
        }

        function updateImage(ctx, next) {
            imgapi.updateImage(img.uuid, {
                public: false
            }, next);
        }

        function resizeMachine(ctx, next) {
            client.post('/my/machines/' + machine, {
                action: 'resize',
                'package': pkgDown.uuid
            }, function onResize(err) {
                t.ifError(err, 'Error resizing machine');
                next(); // don't pass on err here so we can reset public later
            });
        }

        function resetPublic(ctx, next) {
            imgapi.updateImage(img.uuid, {
                public: img.public
            }, next);
        }

        vasync.pipeline({ funcs: [
            getImage, updateImage, resizeMachine, resetPublic
        ]}, function (err) {
            t.ifError(err, 'Error during test');
            t.end();
        });
    });

    suite.test('Wait For resize with private image', function (t) {
        waitAndCheckResize(t, pkgDown);
    });

    function waitAndCheckResize(t, pkg) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'update'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');

            var resize_jobs = jobs.filter(function (job) {
                return (job.params.subtask === 'resize');
            });

            waitForJob(client, resize_jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');

                client.get('/my/machines/' + machine,
                            function (err3, req, res, body) {
                    t.ifError(err3, 'Get machines error');
                    t.equal(body.package, pkg.name, 'correct package name');
                    t.end();
                });
            });
        });
    }

    return cb();
};
