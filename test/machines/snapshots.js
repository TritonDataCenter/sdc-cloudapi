// Copyright 2013 Joyent, Inc. All rights reserved.

var test = require('tap').test;
var common = require('../common');
var machinesCommon = require('./common');
var checkJob = machinesCommon.checkJob;
var waitForJob = machinesCommon.waitForJob;

var TAP_CONF = {
    timeout: 'Infinity '
};


function checkSnapshot(t, snap) {
    t.ok(snap, 'snapshot ok');
    t.ok(snap.name, 'snapshot name ok');
    t.ok(snap.state, 'snapshot state ok');
}

module.exports = function (suite, client, machine, callback) {
    var snapshot;

    suite.test('Take Snapshot', TAP_CONF, function (t) {
        var url = '/my/machines/' + machine + '/snapshots';
        client.post(url, {}, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 201);
            common.checkHeaders(t, res.headers);
            t.ok(body);
            checkSnapshot(t, body);
            snapshot = body;
            t.end();
        });
    });


    suite.test('Wait For Snapshot', TAP_CONF,  function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'snapshot'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs OK');
            t.ok(jobs.length, 'update jobs is array');
            var snapshot_jobs = jobs.filter(function (job) {
                return (/^snapshot/.test(job.name));
            });
            t.ok(snapshot_jobs.length, 'snapshot jobs is an array');
            waitForJob(client, snapshot_jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });


    suite.test('List Snapshots', TAP_CONF, function (t) {
        var url = '/my/machines/' + machine + '/snapshots';
        client.get(url, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            common.checkHeaders(t, res.headers);
            t.ok(body, 'snapshots body');
            t.ok(Array.isArray(body), 'snapshots is an array');
            t.ok(body.length, 'there are snapshots');
            body.forEach(function (s) {
                checkSnapshot(t, s);
            });
            t.end();
        });
    });


    suite.test('Get Snapshot', TAP_CONF, function (t) {
        t.ok(snapshot.name, 'Snapshot name OK');
        var url = '/my/machines/' + machine + '/snapshots/' + snapshot.name;
        client.get(url, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            common.checkHeaders(t, res.headers);
            t.ok(body, 'snapshot body');
            checkSnapshot(t, body);
            t.end();
        });
    });


    suite.test('Rollback Snapshot', TAP_CONF, function (t) {
        t.ok(snapshot.name, 'Snapshot name OK');
        var url = '/my/machines/' + machine + '/snapshots/' + snapshot.name;
        client.post(url, {}, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 202);
            common.checkHeaders(t, res.headers);
            t.end();
        });
    });


    suite.test('Wait For Snapshot Rollback', TAP_CONF,  function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'snapshot'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs OK');
            t.ok(jobs.length, 'update jobs is array');
            var snapshot_jobs = jobs.filter(function (job) {
                return (/^rollback/.test(job.name));
            });
            t.ok(snapshot_jobs.length, 'snapshot jobs is an array');
            waitForJob(client, snapshot_jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });


    suite.test('Delete snapshot', TAP_CONF, function (t) {
        t.ok(snapshot.name, 'Snapshot name OK');
        var url = '/my/machines/' + machine + '/snapshots/' + snapshot.name;
        client.del(url, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            common.checkHeaders(t, res.headers);
            t.end();
        });
    });


    suite.test('Wait For Deleted Snapshot', TAP_CONF,  function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'snapshot'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs OK');
            t.ok(jobs.length, 'update jobs is array');
            var snapshot_jobs = jobs.filter(function (job) {
                return (/^delete-snapshot/.test(job.name));
            });
            t.ok(snapshot_jobs.length, 'snapshot jobs is an array');
            waitForJob(client, snapshot_jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });

    callback();

};
