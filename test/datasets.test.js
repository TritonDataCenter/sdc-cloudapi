// Copyright 2012 Joyent, Inc.  All rights reserved.

var test = require('tap').test;
var uuid = require('node-uuid');
var util = require('util');
var common = require('./common');



// --- Globals

var client, server;
var DATASET_UUID = null;


// --- Helpers

function checkDataset(t, dataset, version) {
    t.ok(dataset, 'dataset object ok');
    t.ok(dataset.id, 'dataset.id');

    t.ok(dataset.name, 'dataset.name');
    t.ok(dataset.version, 'dataset.version');
    t.ok(dataset.type, 'dataset.type');
    t.ok(dataset.requirements, 'dataset.requirements');
    t.ok(dataset.created, 'dataset.created');

    if (/6\.5/.test(version)) {
        t.ok(dataset.urn, 'dataset.urn');
    } else {
        t.equal(typeof (dataset.urn), 'undefined', 'dataset.urn');
    }
}



// --- Tests

test('setup', function (t) {
    common.setup(function (err, _client, _server) {
        t.ifError(err);
        t.ok(_client);
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
        }
        client = _client;
        server = _server;
        t.end();
    });
});


test('ListDatasets OK (6.5)', function (t) {
    client.get({
        path: '/my/datasets',
        headers: {
            'accept-version': '~6.5'
        }
    }, function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets error');
        t.equal(res.statusCode, 200, 'GET /my/datasets status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets body');
        t.ok(Array.isArray(body), 'GET /my/datasets body is an array');
        t.ok(body.length, 'GET /my/datasets body array has elements');
        body.forEach(function (d) {
            checkDataset(t, d, '6.5.0');
        });
        DATASET_UUID = body[0].id;
        t.end();
    });
});


test('GetDataset OK (6.5)', function (t) {
    client.get({
        path: '/my/datasets/smartos',
        headers: {
            'accept-version': '~6.5'
        }
    }, function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets/smartos error');
        t.equal(res.statusCode, 200, 'GET /my/datasets/smartos status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets/smartos body');
        checkDataset(t, body, '6.5.0');
        t.end();
    });
});


test('ListDatasets OK', function (t) {
    client.get('/my/datasets', function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets error');
        t.equal(res.statusCode, 200, 'GET /my/datasets status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets body');
        t.ok(Array.isArray(body), 'GET /my/datasets body is an array');
        t.ok(body.length, 'GET /my/datasets body array has elements');
        body.forEach(function (d) {
            checkDataset(t, d, '7.0.0');
        });
        t.end();
    });
});


test('GetDataset OK', function (t) {
    client.get('/my/datasets/' + DATASET_UUID, function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets/' + DATASET_UUID + ' error');
        t.equal(res.statusCode, 200, 'GET /my/datasets/smartos status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets/smartos body');
        checkDataset(t, body, '7.0.0');
        t.end();
    });
});


test('GetDataset 404', function (t) {
    client.get('/my/datasets/' + uuid(), function (err) {
        t.ok(err, 'GET /my/datasets/ error');
        t.equal(err.statusCode, 404, 'GET /my/datasets/ status');
        t.equal(err.restCode, 'ResourceNotFound', 'GET /my/datasets/ restCode');
        t.ok(err.message, 'GET /my/datasets/ error message');
        t.end();
    });
});


test('teardown', function (t) {
    client.teardown(function (err) {
        t.ifError(err, 'client teardown error');
        if (!process.env.SDC_SETUP_TESTS) {
            server.close(function () {
                t.end();
            });
        } else {
            t.end();
        }
    });
});
