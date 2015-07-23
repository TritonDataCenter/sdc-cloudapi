/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var common = require('../common');
var waitForJob = require('./common').waitForJob;


// --- Tests


module.exports = function (suite, client, machine, callback) {
    if (!machine) {
        return callback();
    }

    suite.test('DeleteMachine', function (t) {
        client.del('/my/machines/' + machine, function (err, req, res) {
            t.ifError(err, 'DELETE /my/machines error');
            t.equal(res.statusCode, 204, 'DELETE /my/machines status');
            common.checkHeaders(t, res.headers);
            t.end();
        });
    });


    suite.test('Wait For Destroyed', function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'destroy'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs);
            t.ok(jobs.length);
            waitForJob(client, jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });

    suite.test('Delete already deleted machine', function (t) {
        client.del('/my/machines/' + machine, function (err, req, res) {
            t.ok(err, 'DELETE /my/machines/ error');
            t.equal(res.statusCode, 410, 'DELETE /my/machines/ statusCode');
            common.checkHeaders(t, res.headers);
            t.end();
        });
    });

    return callback();
};
