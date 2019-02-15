/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

var common = require('../common');
var waitForJob = require('./common').waitForJob;

var checkHeaders = common.checkHeaders;
var checkNotFound = common.checkNotFound;


// --- Helpers


function checkSnapshot(t, snap) {
    t.ok(snap, 'snapshot ok');
    t.ok(snap.name, 'snapshot name ok');
    t.ok(snap.state, 'snapshot state ok');
}


// --- Tests


module.exports = function (suite, client, other, machine, callback) {
    if (!machine) {
        return callback();
    }

    suite.test('Take Snapshot - other', function (t) {
        var url = '/my/machines/' + machine + '/snapshots';
        other.post(url, {}, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    var snapshot;

    suite.test('Take Snapshot', function (t) {
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


    suite.test('Wait For Snapshot', function (t) {
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
                if (err2) {
                    snapshot = null;
                }
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });


    suite.test('List Snapshots', function (t) {
        if (snapshot) {
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
                    t.ok(s.size, 'snapshot size ok');
                });
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('List Snapshots - other', function (t) {
        if (snapshot) {
            var url = '/my/machines/' + machine + '/snapshots';
            other.get(url, function (err, req, res, body) {
                checkNotFound(t, err, req, res, body);
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('Get Snapshot', function (t) {
        if (snapshot) {
            t.ok(snapshot.name, 'Snapshot name OK');
            var url = '/my/machines/' + machine + '/snapshots/' + snapshot.name;
            client.get(url, function (err, req, res, body) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                common.checkHeaders(t, res.headers);
                t.ok(body, 'snapshot body');
                checkSnapshot(t, body);
                t.ok(body.size, 'snapshot size ok');
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('Get Snapshot - other', function (t) {
        if (snapshot) {
            t.ok(snapshot.name, 'Snapshot name OK');
            var url = '/my/machines/' + machine + '/snapshots/' + snapshot.name;
            other.get(url, function (err, req, res, body) {
                checkNotFound(t, err, req, res, body);
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('Rollback Snapshot - other', function (t) {
        if (snapshot) {
            t.ok(snapshot.name, 'Snapshot name OK');
            var url = '/my/machines/' + machine + '/snapshots/' + snapshot.name;
            other.post(url, {}, function (err, req, res, body) {
                checkNotFound(t, err, req, res, body);
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('Rollback Snapshot', function (t) {
        if (snapshot) {
            t.ok(snapshot.name, 'Snapshot name OK');
            var url = '/my/machines/' + machine + '/snapshots/' + snapshot.name;
            client.post(url, {}, function (err, req, res, body) {
                t.ifError(err);
                t.equal(res.statusCode, 202);
                common.checkHeaders(t, res.headers);
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('Wait For Snapshot Rollback', function (t) {
        if (snapshot) {
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
        } else {
            t.end();
        }
    });


    suite.test('Delete snapshot - other', function (t) {
        if (snapshot) {
            t.ok(snapshot.name, 'Snapshot name OK');
            var url = '/my/machines/' + machine + '/snapshots/' + snapshot.name;
            other.del(url, function (err, req, res, body) {
                checkNotFound(t, err, req, res, body);
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('Delete snapshot', function (t) {
        if (snapshot) {
            t.ok(snapshot.name, 'Snapshot name OK');
            var url = '/my/machines/' + machine + '/snapshots/' + snapshot.name;
            client.del(url, function (err, req, res) {
                t.ifError(err);
                t.equal(res.statusCode, 204);
                common.checkHeaders(t, res.headers);
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('Wait For Deleted Snapshot', function (t) {
        if (snapshot) {
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
        } else {
            t.end();
        }
    });


    suite.test('Check deleted snapshot returns 404', function (t) {
        if (snapshot) {
            t.ok(snapshot.name, 'Snapshot name OK');
            var url = '/my/machines/' + machine + '/snapshots/' + snapshot.name;

            client.del(url, function (err, req, res, body) {
                t.ok(err);
                t.equal(res.statusCode, 404);
                t.deepEqual(body, {
                    code: 'ResourceNotFound',
                    message: snapshot.name + ' not found'
                });
                t.end();
            });
        } else {
            t.end();
        }
    });


    return callback();

};
