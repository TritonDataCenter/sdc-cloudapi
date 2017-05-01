/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var common = require('../common');
var machinesCommon = require('./common');


// --- Globals

var checkHeaders = common.checkHeaders;
var checkNotFound = common.checkNotFound;
var checkMachine = machinesCommon.checkMachine;
var waitForJob = machinesCommon.waitForJob;

var TAG_KEY = 'role';
var TAG_VAL = 'unitTest';

var TAG_TWO_KEY = 'smartdc_type';
var TAG_TWO_VAL = 'none';


// --- Tests


module.exports = function (suite, client, other, machine, callback) {
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


    suite.test('ListMachines by tag - other', function (t) {
        var url = '/my/machines?tag.' + TAG_KEY + '=' + TAG_VAL;
        other.get(url, function (err, req, res, body) {
            t.ifError(err);
            t.deepEqual(body, []);
            t.end();
        });
    });


    suite.test('ListMachines all tagged machines', function (t) {
        var url = '/my/machines?tags=*';
        client.get(url, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            checkHeaders(t, res.headers);
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


    suite.test('ListMachines all tagged machines - other', function (t) {
        var url = '/my/machines?tags=*';
        other.get(url, function (err, req, res, body) {
            t.ifError(err);
            t.deepEqual(body, []);
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
            checkHeaders(t, res.headers);
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
            checkHeaders(t, res.headers);
            t.ok(body);
            t.ok(body[TAG_KEY]);
            t.equal(body[TAG_KEY], TAG_VAL);
            t.end();
        });
    });


    suite.test('ListTags - other', function (t) {
        var url = '/my/machines/' + machine + '/tags';
        other.get(url, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('AddTag - other', function (t) {
        var path = '/my/machines/' + machine + '/tags';
        var tags = {};
        tags[TAG_TWO_KEY] = TAG_TWO_VAL;
        other.post(path, tags, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('AddMachineTags/ReplaceMachineTags - bad tags', function (t) {
        var path = '/my/machines/' + machine + '/tags';

        function call(method, tags, expectedErr, next) {
            client[method](path, tags, function (err, req, res, body) {
                t.ok(err);
                t.equal(err.restCode, 'ValidationFailed');
                var verb = (method === 'post' ? 'adding' : 'replacing');
                t.equal(err.message,
                    'error ' + verb + ' tags: Invalid tag parameters');

                t.equal(res.statusCode, 409);

                t.deepEqual(body, {
                    code: 'ValidationFailed',
                    message: 'error ' + verb
                        + ' tags: Invalid tag parameters',
                    errors: [ {
                        field: 'tags',
                        code: 'Invalid',
                        message: expectedErr
                    } ]
                });

                next();
            });
        }

        var unrecognizedMsg = 'Unrecognized special triton tag "triton.foo"';
        var stringMsg = 'Triton tag "triton.cns.services" value must be a ' +
            'string: true (boolean)';
        var booleanMsg = 'Triton tag "triton.cns.disable" value must be a ' +
            'boolean: "true" (string)';
        var dnsMsg = 'invalid "triton.cns.services" tag: Expected DNS name ' +
            'but "_" found.';
        var dockerMsg = 'Special tag "docker:label:com.docker." not supported';

        function postBadTritonTag(_, next) {
            call('post', { 'triton.foo': true }, unrecognizedMsg, next);
        }

        function postBadTritonTagType1(_, next) {
            call('post', { 'triton.cns.services': true }, stringMsg, next);
        }

        function postBadTritonTagType2(_, next) {
            call('post', { 'triton.cns.disable': 'true' }, booleanMsg, next);
        }

        function postBadTritonDNS(_, next) {
            call('post', { 'triton.cns.services': 'foo,_foo.bar' }, dnsMsg,
                next);
        }

        function postBadReservedDockerTag(_, next) {
            call('post', { 'docker:label:com.docker.': 'foo,_foo.bar' },
                dockerMsg, next);
        }

        function putBadTritonTag(_, next) {
            call('put', { 'triton.foo': true }, unrecognizedMsg, next);
        }

        function putBadTritonTagType1(_, next) {
            call('put', { 'triton.cns.services': true }, stringMsg, next);
        }

        function putBadTritonTagType2(_, next) {
            call('put', { 'triton.cns.disable': 'true' }, booleanMsg, next);
        }

        function putBadTritonDNS(_, next) {
            call('put', { 'triton.cns.services': 'foo,_foo.bar' }, dnsMsg,
                next);
        }

        function putBadReservedDockerTag(_, next) {
            call('put', { 'docker:label:com.docker.': 'foo,_foo.bar' },
                dockerMsg, next);
        }

        vasync.pipeline({ funcs: [
            postBadTritonTag, postBadTritonTagType1, postBadTritonTagType2,
            postBadTritonDNS, putBadTritonTag, putBadTritonTagType1,
            putBadTritonTagType2, putBadTritonDNS, postBadReservedDockerTag,
            putBadReservedDockerTag
        ]}, function () {
            t.end();
        });
    });


    suite.test('AddTag', function (t) {
        var path = '/my/machines/' + machine + '/tags';
        var tags = {};
        tags[TAG_TWO_KEY] = TAG_TWO_VAL;
        client.post(path, tags, function (err, req, res, body) {
            t.ifError(err, 'Add Tag error');
            t.equal(res.statusCode, 200, 'Status code');
            checkHeaders(t, res.headers);
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
            checkHeaders(t, res.headers);
            t.ok(body);
            t.equal(body, TAG_VAL);
            t.end();
        });
    });


    suite.test('GetTag - other', function (t) {
        var path = '/my/machines/' + machine + '/tags/' + TAG_KEY;
        other.get(path, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('DeleteTag - other', function (t) {
        var url = '/my/machines/' + machine + '/tags/' + TAG_KEY;
        other.del(url, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('DeleteTag', function (t) {
        var url = '/my/machines/' + machine + '/tags/' + TAG_KEY;
        client.del(url, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            checkHeaders(t, res.headers);
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


    suite.test('ReplaceTags - other', function (t) {
        var path = '/my/machines/' + machine + '/tags',
        tags = {};
        tags[TAG_KEY] = TAG_VAL;
        other.put(path, tags, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('ReplaceTags', function (t) {
        var path = '/my/machines/' + machine + '/tags',
        tags = {};
        tags[TAG_KEY] = TAG_VAL;
        client.put(path, tags, function (err, req, res, body) {
            t.ifError(err, 'Replace Tags Error');
            t.equal(res.statusCode, 200, 'Replace Tags Status');
            checkHeaders(t, res.headers);
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


    suite.test('DeleteAllTags - other', function (t) {
        var url = '/my/machines/' + machine + '/tags';
        other.del(url, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('DeleteAllTags', function (t) {
        var url = '/my/machines/' + machine + '/tags';
        client.del(url, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            checkHeaders(t, res.headers);
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
