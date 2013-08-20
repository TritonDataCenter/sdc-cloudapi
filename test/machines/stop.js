// Copyright 2013 Joyent, Inc. All rights reserved.

var test = require('tap').test;
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

    suite.test('StopMachine', TAP_CONF, function (t) {
        client.post('/my/machines/' + machine, {
            action: 'stop'
        }, function (err) {
            t.ifError(err);
            t.end();
        });
    });


    suite.test('Wait For Stopped', TAP_CONF,  function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'stop'
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

    return callback();
};
