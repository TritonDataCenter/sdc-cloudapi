/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var waitForJob = require('./common').waitForJob;


// --- Tests


module.exports = function (suite, client, machine, callback) {
    if (!machine) {
        return callback();
    }

    suite.test('Disable firewall', function (t) {
        client.post('/my/machines/' + machine, {
            action: 'disable_firewall'
        }, function (err) {
            t.ifError(err, 'Enable firewall error');
            t.end();
        });
    });


    suite.test('Wait For Firewall Disabled',  function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'update'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs OK');
            t.ok(jobs.length, 'update jobs is array');
            var firewall_jobs = jobs.filter(function (job) {
                return (typeof (job.params.payload.firewall_enabled) !==
                    'undefined');
            });
            t.ok(firewall_jobs.length, 'firewall jobs is an array');
            waitForJob(client, firewall_jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });


    suite.test('Enable firewall', function (t) {
        client.post('/my/machines/' + machine, {
            action: 'enable_firewall'
        }, function (err) {
            t.ifError(err, 'Enable firewall error');
            t.end();
        });
    });


    suite.test('Wait For Firewall Enabled', function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'update'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs OK');
            t.ok(jobs.length, 'update jobs is array');
            var firewall_jobs = jobs.filter(function (job) {
                return (typeof (job.params.payload.firewall_enabled) !==
                    'undefined');
            });
            t.ok(firewall_jobs.length, 'firewall jobs is an array');
            waitForJob(client, firewall_jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });

    return callback();
};
