// Copyright 2013 Joyent, Inc. All rights reserved.

var test = require('tap').test;
var common = require('../common');
var machinesCommon = require('./common');
var checkMachine = machinesCommon.checkMachine;
var TAP_CONF = {
    timeout: 'Infinity '
};

var TAG_KEY = 'role';
var TAG_VAL = 'unitTest';

var TAG_TWO_KEY = 'smartdc_type';
var TAG_TWO_VAL = 'none';

module.exports = function (suite, client, machine, callback) {

    if (!machine) {
        return callback();
    }

    suite.test('ListMachines by tag', TAP_CONF, function (t) {
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


    suite.test('ListMachines all tagged machines', TAP_CONF, function (t) {
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
    suite.test('Attempt to list other owner machines by tag', TAP_CONF,
        function (t) {
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


    suite.test('ListTags', TAP_CONF, function (t) {
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


    suite.test('AddTag', TAP_CONF, function (t) {
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
            t.end();
        });
    });


    suite.test('GetTag', TAP_CONF, function (t) {
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


    suite.test('DeleteTag', TAP_CONF, function (t) {
        var url = '/my/machines/' + machine + '/tags/' + TAG_KEY;
        client.del(url, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            common.checkHeaders(t, res.headers);
            t.end();
        });
    });


    suite.test('ReplaceTags', TAP_CONF, function (t) {
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


    suite.test('DeleteAllTags', TAP_CONF, function (t) {
        var url = '/my/machines/' + machine + '/tags';
        client.del(url, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            common.checkHeaders(t, res.headers);
            t.end();
        });
    });

    return callback();
};
