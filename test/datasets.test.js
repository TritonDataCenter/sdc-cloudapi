/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var test = require('tape').test;
var util = require('util');
var common = require('./common');



// --- Globals


var CLIENTS;
var CLIENT;
var SERVER;

var DATASET;


// --- Helpers


function checkDataset(t, dataset, version, path) {
    if (typeof (path) === 'undefined') {
        path = '/my/datasets';
    }

    t.ok(dataset, 'dataset object ok');
    t.ok(dataset.id, 'dataset.id');

    t.ok(dataset.name, 'dataset.name');
    t.ok(dataset.version, 'dataset.version');
    t.ok(dataset.type, 'dataset.type');
    t.ok(dataset.requirements, 'dataset.requirements');

    t.notEqual(dataset.name, 'docker-layer',
        'should be no listed docker-layer images');

    if (/\/images/.test(path)) {
        t.equal(typeof (dataset.urn), 'undefined', 'dataset.urn');
    } else {
        t.ok(dataset.urn, 'dataset.urn');
    }

    if (/6\.5/.test(version)) {
        t.notEqual(typeof (dataset['default']), 'undefined', 'dataset.default');
    } else {
        t.equal(typeof (dataset['default']), 'undefined', 'dataset.default');
    }
}


// --- Tests


test('setup', function (t) {
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        SERVER  = server;

        t.end();
    });
});


test('ListDatasets OK (6.5)', function (t) {
    CLIENT.get({
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
        // PUBAPI-838: Prevent exceptions when images haven't been imported
        // before running the tests:
        if (body[0]) {
            DATASET = body[0];
        }
        t.end();
    });
});


test('GetDataset by name OK (6.5)', function (t) {
    CLIENT.get({
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
    CLIENT.get('/my/datasets', function (err, req, res, body) {
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

// PUBAPI-549
test('ListImages OK', function (t) {
    CLIENT.get('/my/images', function (err, req, res, body) {
        t.ifError(err, 'GET /my/images error');
        t.equal(res.statusCode, 200, 'GET /my/images status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/images body');
        t.ok(Array.isArray(body), 'GET /my/images body is an array');
        t.ok(body.length, 'GET /my/images body array has elements');
        body.forEach(function (d) {
            checkDataset(t, d, '7.0.0', '/my/images');
        });
        t.end();
    });
});


test('Search datasets (7.0)', function (t) {
    CLIENT.get('/my/datasets?os=plan9', function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets error');
        t.equal(res.statusCode, 200, 'GET /my/datasets status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets body');
        t.ok(Array.isArray(body), 'GET /my/datasets body is an array');
        t.ok(!body.length, 'GET /my/datasets body array has no elements');
        t.end();
    });
});


test('GetDataset OK', function (t) {
    CLIENT.get('/my/datasets/' + DATASET.id, function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets/' + DATASET.id + ' error');
        t.equal(res.statusCode, 200, 'GET /my/datasets/smartos status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets/smartos body');
        checkDataset(t, body, '7.0.0');
        t.end();
    });
});


test('GetDataset should not return non-permission datasets', function (t) {
    CLIENT.imgapi.listImages(function (err, images) {
        t.ifError(err);

        var accountUuid = CLIENT.account.uuid;
        var inaccessibleImage = images.filter(function (img) {
            return img.owner !== accountUuid && !img.public;
        })[0];

        if (!inaccessibleImage) {
            // can't continue test, so move on
            return t.end();
        }

        var path = '/my/datasets/' + inaccessibleImage.uuid;
        return CLIENT.get(path, function (err2, req, res, body) {
            t.ok(err2);

            t.deepEqual(body, {
                code: 'ResourceNotFound',
                message: 'image not found'
            });

            t.end();
        });
    });
});


test('Get Image By URN OK', function (t) {
    CLIENT.get('/my/images/' + encodeURIComponent(DATASET.urn),
        function (err, req, res, body) {
            t.ifError(err, 'GET /my/images/' + DATASET.urn + ' error');
            t.equal(res.statusCode, 200, 'GET /my/images/' + DATASET.urn +
                ' status');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'GET /my/images/' + DATASET.urn + ' body');
            checkDataset(t, body, '7.0.0', '/my/images');
            t.end();
        });
});


test('GetDataset 404', function (t) {
    CLIENT.get('/my/datasets/' + common.uuid(), function (err) {
        t.ok(err, 'GET /my/datasets/ error');
        t.equal(err.statusCode, 404, 'GET /my/datasets/ status');
        t.equal(err.restCode, 'ResourceNotFound', 'GET /my/datasets/ restCode');
        t.ok(err.message, 'GET /my/datasets/ error message');
        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function () {
        t.end();
    });
});
