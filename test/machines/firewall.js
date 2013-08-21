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


    suite.test('Disable firewall', TAP_CONF, function (t) {
        client.post('/my/machines/' + machine, {
            action: 'disable_firewall'
        }, function (err) {
            t.ifError(err, 'Enable firewall error');
            t.end();
        });
    });


    suite.test('Wait For Firewall Disabled', TAP_CONF,  function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'update'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs OK');
            t.ok(jobs.length, 'update jobs is array');
            var firewall_jobs = jobs.filter(function (job) {
                return (typeof (job.params.firewall_enabled) !== 'undefined');
            });
            t.ok(firewall_jobs.length, 'firewall jobs is an array');
            waitForJob(client, firewall_jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });


    suite.test('Enable firewall', TAP_CONF, function (t) {
        client.post('/my/machines/' + machine, {
            action: 'enable_firewall'
        }, function (err) {
            t.ifError(err, 'Enable firewall error');
            t.end();
        });
    });


    suite.test('Wait For Firewall Enabled', TAP_CONF,  function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'update'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs OK');
            t.ok(jobs.length, 'update jobs is array');
            var firewall_jobs = jobs.filter(function (job) {
                return (typeof (job.params.firewall_enabled) !== 'undefined');
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
