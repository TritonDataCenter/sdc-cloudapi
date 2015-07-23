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


// --- Globals


var META_KEY = 'foo';
var META_VAL = 'bar';

var META_64_KEY = 'sixtyfour';
var META_64_VAL = new Buffer('Hello World').toString('base64');


// --- Tests


module.exports = function (suite, client, machine, callback) {
    if (!machine) {
        return callback();
    }
    suite.test('ListMetadata', function (t) {
        var url = '/my/machines/' + machine + '/metadata';
        client.get(url, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            common.checkHeaders(t, res.headers);
            t.ok(body);
            t.ok(body[META_KEY]);
            t.equal(body[META_KEY], META_VAL);
            t.ok(body[META_64_KEY]);
            t.equal(body[META_64_KEY], META_64_VAL);
            t.equal(typeof (body.credentials), 'undefined');
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
            common.checkHeaders(t, res.headers);
            t.ok(body, 'Add Metadata Body');
            t.ok(body.bar, 'Add Metadata Metadata');
            t.end();
        });
    });


    suite.test('wait for add metadata job',  function (t) {
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
            common.checkHeaders(t, res.headers);
            t.ok(body);
            t.equal(body, META_VAL);
            t.end();
        });
    });


    suite.test('DeleteMetadata', function (t) {
        var url = '/my/machines/' + machine + '/metadata/' + META_KEY;
        client.del(url, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            common.checkHeaders(t, res.headers);
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


    suite.test('DeleteMetadataCredentials', function (t) {
        var url = '/my/machines/' + machine + '/metadata/credentials';
        client.del(url, function (err, req, res) {
            t.ok(err);
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


    suite.test('DeleteAllMetadata', function (t) {
        var url = '/my/machines/' + machine + '/metadata';
        client.del(url, function (err, req, res) {
            t.ifError(err, 'Delete All Metadata Error');
            t.equal(res.statusCode, 204, 'Delete All Metadata status');
            common.checkHeaders(t, res.headers);
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
