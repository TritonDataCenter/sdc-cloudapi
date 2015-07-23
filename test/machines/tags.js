/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var common = require('../common');
var machinesCommon = require('./common');
var checkMachine = machinesCommon.checkMachine;
var waitForJob = machinesCommon.waitForJob;


// --- Globals


var TAG_KEY = 'role';
var TAG_VAL = 'unitTest';

var TAG_TWO_KEY = 'smartdc_type';
var TAG_TWO_VAL = 'none';


// --- Tests


module.exports = function (suite, client, machine, callback) {
    if (!machine) {
        return callback();
    }

    suite.test('ListMachines by tag', function (t) {
        var url = '/my/machines?tag.' + TAG_KEY + '=' + TAG_VAL;
        client.get(url, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            common.checkHeaders(t, res.headers);
            t.ok(body);
            t.ok(Array.isArray(body));
            t.ok(body.length);
            body.forEach(function (m) {
                checkMachine(t, m);
                machine = m.id;
            });
            t.end();
        });
    });


    suite.test('ListMachines all tagged machines', function (t) {
        var url = '/my/machines?tags=*';
        client.get(url, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            common.checkHeaders(t, res.headers);
            t.ok(body);
            t.ok(Array.isArray(body));
            t.ok(body.length);
            body.forEach(function (m) {
                checkMachine(t, m);
                machine = m.id;
            });
            t.end();
        });
    });


    // This is to make sure we're not getting machines from a different customer
    // when searching by tags:
    suite.test('Attempt to list other owner machines by tag', function (t) {
        // Admin user will always have all of the HN zones with this tag:
        var url = '/my/machines?tag.smartdc_type=core';
        client.get(url, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            common.checkHeaders(t, res.headers);
            t.ok(body);
            t.ok(Array.isArray(body));
            t.equal(0, body.length);
            t.end();
        });
    });


    suite.test('ListTags', function (t) {
        var url = '/my/machines/' + machine + '/tags';
        client.get(url, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            common.checkHeaders(t, res.headers);
            t.ok(body);
            t.ok(body[TAG_KEY]);
            t.equal(body[TAG_KEY], TAG_VAL);
            t.end();
        });
    });


    suite.test('AddTag', function (t) {
        var path = '/my/machines/' + machine + '/tags',
        tags = {};
        tags[TAG_TWO_KEY] = TAG_TWO_VAL;
        client.post(path, tags, function (err, req, res, body) {
            t.ifError(err, 'Add Tag error');
            t.equal(res.statusCode, 200, 'Status code');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'AddTag Body');
            t.ok(body[TAG_TWO_KEY], 'Add Tag Key');
            t.equal(body[TAG_TWO_KEY], TAG_TWO_VAL, 'Add Tag Value');
            t.ok(body[TAG_KEY], 'Original tag key still present');
            t.equal(body[TAG_KEY], TAG_VAL, 'Original tag value still present');
            t.end();
        });
    });


    suite.test('wait for add tag job', function (t) {
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


    suite.test('GetTag', function (t) {
        var path = '/my/machines/' + machine + '/tags/' + TAG_KEY;
        client.get(path, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            common.checkHeaders(t, res.headers);
            t.ok(body);
            t.equal(body, TAG_VAL);
            t.end();
        });
    });


    suite.test('DeleteTag', function (t) {
        var url = '/my/machines/' + machine + '/tags/' + TAG_KEY;
        client.del(url, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            common.checkHeaders(t, res.headers);
            t.end();
        });
    });


    suite.test('wait for delete tag job', function (t) {
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


    suite.test('ReplaceTags', function (t) {
        var path = '/my/machines/' + machine + '/tags',
        tags = {};
        tags[TAG_KEY] = TAG_VAL;
        client.put(path, tags, function (err, req, res, body) {
            t.ifError(err, 'Replace Tags Error');
            t.equal(res.statusCode, 200, 'Replace Tags Status');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'Replace Tags Body');
            t.ok(body[TAG_KEY], 'Tag Key');
            t.equal(body[TAG_KEY], TAG_VAL, 'Tag Value');
            t.equal(typeof (body[TAG_TWO_KEY]), 'undefined', 'Removed Tag');
            t.end();
        });

    });


    suite.test('wait for replace tags job', function (t) {
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


    suite.test('DeleteAllTags', function (t) {
        var url = '/my/machines/' + machine + '/tags';
        client.del(url, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            common.checkHeaders(t, res.headers);
            t.end();
        });
    });


    suite.test('wait for delete all tags job', function (t) {
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
