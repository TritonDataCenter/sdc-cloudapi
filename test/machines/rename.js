// Copyright 2013 Joyent, Inc. All rights reserved.

var test = require('tap').test;
var uuid = require('node-uuid');
var common = require('../common');
var machinesCommon = require('./common');
var checkJob = machinesCommon.checkJob;
var waitForJob = machinesCommon.waitForJob;
var TAP_CONF = {
    timeout: 'Infinity '
};

module.exports = function (suite, client, machine, callback) {
    if (!machine) {
        return callback();
    }


    suite.test('Rename Machine', TAP_CONF, function (t) {
        client.post('/my/machines/' + machine, {
            action: 'rename',
            name: 'b' + uuid().substr(0, 7)
        }, function (err) {
            t.ifError(err, 'Rename machine error');
            t.end();
        });
    });


    suite.test('Wait For Renamed', TAP_CONF,  function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'update'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs OK');
            t.ok(jobs.length, 'update jobs is array');
            var rename_jobs = jobs.filter(function (job) {
                return (typeof (job.params.alias) !== 'undefined');
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
