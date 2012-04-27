// Copyright 2012 Joyent, Inc.  All rights reserved.

var test = require('tap').test;
var uuid = require('node-uuid');

var common = require('./common');



///--- Globals

var client;



///--- Helpers

function checkDataset(t, dataset) {
    t.ok(dataset);
    t.ok(dataset.id);
    t.ok(dataset.urn);
    t.ok(dataset.name);
    t.ok(dataset.type);
    t.ok(dataset.description);
    t.ok(dataset['default'] !== undefined);
    t.ok(dataset.requirements);
    t.ok(dataset.version);
    t.ok(dataset.created);
}



///--- Tests

test('setup', function(t) {
    common.setup(function(err, _client) {
        t.ifError(err);
        t.ok(_client);
        client = _client;
        t.end();
    });
});


test('ListDatasets OK', function(t) {
    client.get('/my/datasets', function(err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        body.forEach(function(d) {
            checkDataset(t, d);
        });
        t.end();
    });
});


test('GetDataset OK', function(t) {
    client.get('/my/datasets/smartos', function(err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        checkDataset(t, body);
        t.end();
    });
});


test('GetDataset 404', function(t) {
    client.get('/my/datasets/' + uuid(), function(err) {
        t.ok(err);
        t.equal(err.httpCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);
        t.end();
    });
});


test('teardown', function(t) {
    client.teardown(function(err) {
        t.ifError(err);
        t.end();
    });
});
