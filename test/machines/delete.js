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
        TAP_CONF.skip = true;
    }
    suite.test('DeleteMachine', TAP_CONF, function (t) {
        client.del('/my/machines/' + machine, function (err, req, res) {
            t.ifError(err, 'DELETE /my/machines error');
            t.equal(res.statusCode, 204, 'DELETE /my/machines status');
            common.checkHeaders(t, res.headers);
            t.end();
        });
    });


    suite.test('Wait For Destroyed', TAP_CONF,  function (t) {
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

    callback();
};
