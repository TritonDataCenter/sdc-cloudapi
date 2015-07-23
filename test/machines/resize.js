/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var common = require('../common');
var uuid = common.uuid;
var waitForJob = require('./common').waitForJob;


// --- Tests


module.exports = function (suite, client, machine, pkgSame, pkgUp, cb) {
    if (!machine) {
        return cb();
    }

    suite.test('Resize Machine up on coal', function (t) {
        t.ok(pkgSame, 'Resize same package OK');

        if (!common.getCfg().datacenters.coal) {
            return t.end();
        }

        return client.post('/my/machines/' + machine, {
            action: 'resize',
            'package': pkgUp.name
        }, function (err) {
            t.ok(err);

            var body = err.body;
            t.ok(body);

            if (err.body) {
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


    suite.test('Resize Machine', function (t) {
        t.ok(pkgUp, 'Resize up package OK');
        console.log('Resizing to package: %j', pkgSame);
        client.post('/my/machines/' + machine, {
            action: 'resize',
            'package': pkgSame.name
        }, function (err) {
            t.ifError(err, 'Resize machine error');
            t.end();
        });
    });


    suite.test('Wait For Resized', function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'update'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs OK');
            t.ok(jobs.length, 'update jobs is array');
            var resize_jobs = jobs.filter(function (job) {
                return (job.params.subtask === 'resize');
            });
            t.ok(resize_jobs.length, 'resize jobs is an array');
            waitForJob(client, resize_jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });

    return cb();
};
