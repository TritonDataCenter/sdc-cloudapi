/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var uuid = require('../common').uuid;
var waitForJob = require('./common').waitForJob;


// --- Tests


module.exports = function (suite, client, machine, callback) {
    if (!machine) {
        return callback();
    }

    suite.test('Rename Machine', function (t) {
        client.post('/my/machines/' + machine, {
            action: 'rename',
            name: 'b' + uuid().substr(0, 7)
        }, function (err) {
            t.ifError(err, 'Rename machine error');
            t.end();
        });
    });


    suite.test('Wait For Renamed', function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'update'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs OK');
            t.ok(jobs.length, 'update jobs is array');
            var rename_jobs = jobs.filter(function (job) {
                return (job.params.subtask === 'rename');
            });
            t.ok(rename_jobs.length, 'rename jobs is an array');
            waitForJob(client, rename_jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });

    return callback();
};
