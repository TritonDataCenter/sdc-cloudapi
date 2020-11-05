/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var common = require('../common');
var waitForJob = require('./common').waitForJob;

var checkNotFound = common.checkNotFound;
var checkHeaders = common.checkHeaders;


// --- Globals


var META_KEY = 'foo';
var META_VAL = 'bar';

var META_64_KEY = 'sixtyfour';
var META_64_VAL = new Buffer('Hello World').toString('base64');


// --- Tests


module.exports = function (suite, client, other, machine, callback) {
    if (!machine) {
        return callback();
    }

    suite.test('ListMetadata - other', function (t) {
        var url = '/my/machines/' + machine + '/metadata';
        other.get(url, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('ListMetadata', function (t) {
        var url = '/my/machines/' + machine + '/metadata';
        client.get(url, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            checkHeaders(t, res.headers);
            t.ok(body);
            t.ok(body[META_KEY]);
            t.equal(body[META_KEY], META_VAL);
            t.ok(body[META_64_KEY]);
            t.equal(body[META_64_KEY], META_64_VAL);
            t.equal(typeof (body.credentials), 'undefined');
            t.end();
        });
    });


    suite.test('AddMetadata - other', function (t) {
        var path = '/my/machines/' + machine + '/metadata';
        var meta = {
            bar: 'baz'
        };
        other.post(path, meta, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('AddMetadata', function (t) {
        var path = '/my/machines/' + machine + '/metadata',
        meta = {
            bar: 'baz'
        };
        client.post(path, meta, function (err, req, res, body) {
            t.ifError(err, 'Add Metadata error');
            t.equal(res.statusCode, 200, 'Add Metadata Status');
            checkHeaders(t, res.headers);
            t.ok(body, 'Add Metadata Body');
            t.ok(body.bar, 'Add Metadata Metadata');
            t.end();
        });
    });


    suite.test('wait for add metadata job', function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'update'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs ok');
            t.ok(jobs.length, 'list jobs is an array');
            waitForJob(client, jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });


    suite.test('GetMetadata', function (t) {
        var path = '/my/machines/' + machine + '/metadata/' + META_KEY;
        client.get(path, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            checkHeaders(t, res.headers);
            t.ok(body);
            t.equal(body, META_VAL);
            t.end();
        });
    });


    suite.test('GetMetadata - other', function (t) {
        var path = '/my/machines/' + machine + '/metadata/' + META_KEY;
        other.get(path, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('GetMetadata Credentials', function (t) {
        var url = '/my/machines/' + machine + '/metadata/credentials';
        client.get(url, function (err, req, res, body) {
            t.ifError(err);
            t.deepEqual(body, {
                root: 'secret',
                admin: 'secret'

            });
            t.end();
        });
    });


    suite.test('GetMetadata Credentials - other', function (t) {
        var url = '/my/machines/' + machine + '/metadata/credentials';
        other.get(url, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('DeleteMetadata - other', function (t) {
        var url = '/my/machines/' + machine + '/metadata/' + META_KEY;
        other.del(url, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('DeleteMetadata', function (t) {
        var url = '/my/machines/' + machine + '/metadata/' + META_KEY;
        client.del(url, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            checkHeaders(t, res.headers);
            t.end();
        });
    });


    suite.test('wait for delete metadata job', function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'update'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs ok');
            t.ok(jobs.length, 'list jobs is an array');
            waitForJob(client, jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });


    suite.test('DeleteMetadataCredentials - other', function (t) {
        var url = '/my/machines/' + machine + '/metadata/credentials';
        other.del(url, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('DeleteMetadataCredentials', function (t) {
        var url = '/my/machines/' + machine + '/metadata/credentials';
        client.del(url, function (err, req, res) {
            t.ok(err);
            // XXX: 409?
            t.equal(res.statusCode, 409);
            t.end();
        });
    });


    suite.test('wait for delete credentials job', function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'update'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs ok');
            t.ok(jobs.length, 'list jobs is an array');
            waitForJob(client, jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });


    suite.test('DeleteAllMetadata - other', function (t) {
        var url = '/my/machines/' + machine + '/metadata';
        other.del(url, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('DeleteAllMetadata', function (t) {
        var url = '/my/machines/' + machine + '/metadata';
        client.del(url, function (err, req, res) {
            t.ifError(err, 'Delete All Metadata Error');
            t.equal(res.statusCode, 204, 'Delete All Metadata status');
            checkHeaders(t, res.headers);
            t.end();
        });
    });


    suite.test('wait for delete all metadata job', function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'update'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs ok');
            t.ok(jobs.length, 'list jobs is an array');
            waitForJob(client, jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });


    return callback();
};
