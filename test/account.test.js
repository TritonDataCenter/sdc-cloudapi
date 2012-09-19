// Copyright 2012 Joyent, Inc.  All rights reserved.

var test = require('tap').test;
var uuid = require('node-uuid');
var util = require('util');
var common = require('./common');



// --- Globals

var client, server;


// --- Helpers

function checkOk(t, err, req, res, body) {
    t.ifError(err);
    t.ok(req);
    t.ok(res);
    common.checkHeaders(t, res.headers);
    t.ok(body);
    t.equal(body.login, client.testUser);
    t.equal(body.email, client.testUser);
    t.ok(body.id);
    t.equal(res.statusCode, 200);
}



// --- Tests

test('setup', function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);
        client = _client;
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
        }
        server = _server;
        t.end();
    });
});


test('GetAccount(my) OK', function (t) {
    client.get('/my', function (err, req, res, obj) {
        checkOk(t, err, req, res, obj);
        t.end();
    });
});


test('GetAccount(:login) OK', function (t) {
    var path = '/' + encodeURIComponent(client.testUser);
    client.get(path, function (err, req, res, obj) {
        checkOk(t, err, req, res, obj);
        t.end();
    });
});


test('GetAccount 403', function (t) {
    client.get('/admin', function (err) {
        t.ok(err);
        t.equal(err.statusCode, 403);
        t.equal(err.restCode, 'NotAuthorized');
        t.ok(err.message);
        t.end();
    });
});


test('GetAccount 404', function (t) {
    client.get('/' + uuid(), function (err) {
        t.ok(err);
        t.equal(err.statusCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.end();
    });
});


test('teardown', function (t) {
    client.teardown(function (err) {
        t.ifError(err);
        if (!process.env.SDC_SETUP_TESTS) {
            server.close(function () {
                t.end();
            });
        } else {
            t.end();
        }
    });
});
