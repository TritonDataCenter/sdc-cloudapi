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
var semver = require('semver');
var common = require('./common');


// --- Globals


var CLIENTS;
var CLIENT;
var OTHER;
var SERVER;

var RAW_DATASETS = {};
var DATASET;


// --- Helpers


function checkDataset(t, dataset, path) {
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

    t.notEqual(typeof (dataset.default), 'undefined', 'dataset.default');
    t.equal(dataset.type, 'smartmachine');
}


function checkDatasetViewable(t, img, client) {
    t.ok(img);
    t.ok(client);

    var ownerUuid = client.account.uuid;
    var rawImg = RAW_DATASETS[img.id];

    t.ok(rawImg);
    t.equal(rawImg.state, 'active');
    t.ok(rawImg.public || rawImg.owner === ownerUuid);
}


function getInaccessibleDataset(client) {
    var accountUuid = client.account.uuid;

    var inaccessibleImages = Object.keys(RAW_DATASETS).map(function (imgUuid) {
        return RAW_DATASETS[imgUuid];
    });

    // some tests require a urn, so prefer that if available
    inaccessibleImages = inaccessibleImages.filter(function (img) {
        return img.urn;
    }).concat(inaccessibleImages);

    inaccessibleImages = inaccessibleImages.filter(function (img) {
        return img.owner !== accountUuid && !img.public;
    });

    return inaccessibleImages[0];
}


// --- Tests


test('setup', function (t) {
    common.setup('~6.5', function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        OTHER   = clients.other;
        SERVER  = server;

        CLIENT.imgapi.listImages(function (err, imgs) {
            t.ifError(err);

            imgs.forEach(function (img) {
                RAW_DATASETS[img.uuid] = img;
            });

            t.end();
        });
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
            checkDataset(t, d);
            checkDatasetViewable(t, d, CLIENT);
        });

        // PUBAPI-838: Prevent exceptions when images haven't been imported
        // before running the tests:
        if (body[0]) {
            DATASET = body[0];
        }

        t.end();
    });
});


test('GetDataset by name OK', function (t) {
    CLIENT.get('/my/datasets/base', function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets/base error');
        t.equal(res.statusCode, 200, 'GET /my/datasets/base status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets/base body');
        checkDataset(t, body);
        t.equal(body.name, 'base');
        t.end();
    });
});


test('GetDataset by name - other', function (t) {
    var inaccessibleDataset = getInaccessibleDataset(OTHER);
    var path = '/my/datasets/' + inaccessibleDataset.name;

    OTHER.get(path, function (err, req, res, body) {
        t.ok(err);

        t.equal(res.statusCode, 404);
        t.equal(body.code, 'ResourceNotFound');

        t.end();
    });
});


test('GetDataset OK', function (t) {
    CLIENT.get('/my/datasets/' + DATASET.id, function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets/' + DATASET.id + ' error');
        t.equal(res.statusCode, 200, 'GET /my/datasets/:uuid status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets/:uuid body');
        checkDataset(t, body);
        t.end();
    });
});


test('GetDataset - other', function (t) {
    var inaccessibleDataset = getInaccessibleDataset(OTHER);
    var path = '/my/datasets/' + inaccessibleDataset.uuid;

    OTHER.get(path, function (err, req, res, body) {
        t.ok(err);

        t.equal(res.statusCode, 404);

        t.deepEqual(body, {
            code: 'ResourceNotFound',
            message: 'image not found'
        });

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
