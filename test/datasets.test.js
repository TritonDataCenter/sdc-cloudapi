// Copyright 2012 Joyent, Inc.  All rights reserved.

var test = require('tap').test;
var uuid = require('node-uuid');
var util = require('util');
var common = require('./common');



// --- Globals

var client, server;



// --- Helpers

function checkDataset(t, dataset) {
    t.ok(dataset, 'dataset object ok');
    t.ok(dataset.id, 'dataset.id');
    t.ok(dataset.urn, 'dataset.urn');
    t.ok(dataset.name, 'dataset.name');
    t.ok(dataset.type, 'dataset.type');
    t.ok(dataset.description, 'dataset.description');
    t.ok(dataset.requirements, 'dataset.requirements');
    t.ok(dataset.version, 'dataset.version');
    t.ok(dataset.created, 'dataset.created');
}



// --- Tests

test('setup', function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);
        t.ok(_server);
        client = _client;
        server = _server;
        t.end();
    });
});


test('ListDatasets OK', function (t) {
    client.get('/my/datasets', function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets error');
        t.equal(res.statusCode, 200, 'GET /my/datasets status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets body');
        t.ok(util.isArray(body), 'GET /my/datasets body is an array');
        t.ok(body.length, 'GET /my/datasets body array has elements');
        body.forEach(function (d) {
            checkDataset(t, d);
        });
        t.end();
    });
});


test('GetDataset OK', function (t) {
    client.get('/my/datasets/smartos', function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets/smartos error');
        t.equal(res.statusCode, 200, 'GET /my/datasets/smartos status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets/smartos body');
        checkDataset(t, body);
        t.end();
    });
});


test('GetDataset 404', function (t) {
    client.get('/my/datasets/' + uuid(), function (err) {
        t.ok(err, 'GET /my/datasets/ error');
        t.equal(err.httpCode, 404, 'GET /my/datasets/ status');
        t.equal(err.restCode, 'ResourceNotFound', 'GET /my/datasets/ restCode');
        t.ok(err.message, 'GET /my/datasets/ error message');
        t.end();
    });
});


test('teardown', function (t) {
    client.teardown(function (err) {
        t.ifError(err, 'client teardown error');
        server.close(function () {
            t.end();
        });
    });
});
