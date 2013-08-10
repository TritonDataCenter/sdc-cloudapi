// Copyright 2013 Joyent, Inc. All rights reserved.

var test = require('tap').test;
var common = require('../common');
var machinesCommon = require('./common');
var checkMachine = machinesCommon.checkMachine;
var TAP_CONF = {
    timeout: 'Infinity '
};

var META_KEY = 'foo';
var META_VAL = 'bar';

var META_64_KEY = 'sixtyfour';
var META_64_VAL = new Buffer('Hello World').toString('base64');


module.exports = function (suite, client, machine, callback) {
    suite.test('ListMetadata', TAP_CONF, function (t) {
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


    suite.test('AddMetadata', TAP_CONF, function (t) {
        var path = '/my/machines/' + machine + '/metadata',
        meta = {
            bar: 'baz'
        };
        client.post(path, meta, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            common.checkHeaders(t, res.headers);
            t.ok(body);
            t.ok(body.bar);
            t.end();
        });
    });


    suite.test('GetMetadata', TAP_CONF, function (t) {
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


    suite.test('DeleteMetadata', TAP_CONF, function (t) {
        var url = '/my/machines/' + machine + '/metadata/' + META_KEY;
        client.del(url, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            common.checkHeaders(t, res.headers);
            t.end();
        });
    });


    suite.test('DeleteMetadataCredentials', TAP_CONF, function (t) {
        var url = '/my/machines/' + machine + '/metadata/credentials';
        client.del(url, function (err, req, res) {
            t.ok(err);
            t.equal(res.statusCode, 409);
            t.end();
        });
    });


    suite.test('DeleteAllMetadata', TAP_CONF, function (t) {
        var url = '/my/machines/' + machine + '/metadata';
        client.del(url, function (err, req, res) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            common.checkHeaders(t, res.headers);
            t.end();
        });
    });

    callback();
};
