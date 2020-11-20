/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var test = require('tape');
var common = require('./common');


// --- Globals


var CLIENTS;
var CLIENT;
var SERVER;

var RAW_IMAGES = {};
var IMAGE;


// --- Helpers


function checkImage(t, image, path) {
    if (typeof (path) === 'undefined') {
        path = '/my/images';
    }

    t.ok(image, 'image object ok');
    t.ok(image.id, image.id + ': image.id');

    t.ok(image.name, image.id + ': image.name');
    t.ok(image.version, image.id + ': image.version');
    t.ok(image.type, image.id + ': image.type');
    t.ok(image.requirements, image.id + ': image.requirements');

    t.notEqual(image.name, 'docker-layer',
        image.id + ': should be no listed name="docker-layer" images');

    if (/\/images/.test(path)) {
        t.equal(typeof (image.urn), 'undefined', image.id + ': image.urn');
    } else {
        t.ok(image.urn, image.id + ': image.urn');
    }

    t.equal(typeof (image.default), 'undefined', image.id + ': image.default');
    t.ok(['smartmachine', 'virtualmachine'].indexOf(image.type) !== -1,
        image.id + ': image.type is one of smartmachine or virtualmachine: '
        + image.type);
}


function checkImageViewable(t, img, client) {
    t.ok(img);
    t.ok(client);

    var ownerUuid = client.account.uuid;
    var rawImg = RAW_IMAGES[img.id];

    t.ok(rawImg);
    t.equal(rawImg.state, 'active');
    t.ok(rawImg.public || rawImg.owner === ownerUuid);
}


function getInaccessibleImage(client) {
    var accountUuid = client.account.uuid;

    var inaccessibleImages = Object.keys(RAW_IMAGES).map(function (imgUuid) {
        return RAW_IMAGES[imgUuid];
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
    common.setup({clientApiVersion: '~7.0'}, function (_, clients, server) {
        CLIENTS = clients;
        CLIENT = clients.user;
        SERVER = server;

        CLIENT.imgapi.listImages(function (err, imgs) {
            t.ifError(err);

            imgs.forEach(function (img) {
                RAW_IMAGES[img.uuid] = img;
            });

            t.end();
        });
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
            checkImage(t, d, '/my/images');
            checkImageViewable(t, d, CLIENT);
        });

        if (body[0]) {
            IMAGE = body[0];
        }

        t.end();
    });
});


test('Search images, no results', function (t) {
    CLIENT.get('/my/images?os=plan9', function (err, req, res, body) {
        t.ifError(err, 'GET /my/images error');
        t.equal(res.statusCode, 200, 'GET /my/images status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/images body');
        t.ok(Array.isArray(body), 'GET /my/images body is an array');
        t.ok(!body.length, 'GET /my/images body array has no elements');
        t.end();
    });
});


test('Search images, results', function (t) {
    CLIENT.get('/my/images?os=smartos', function (err, req, res, body) {
        t.ifError(err);

        t.ok(body.length > 0);
        body.forEach(function (d) {
            checkImage(t, d);
            checkImageViewable(t, d, CLIENT);
            t.equal(d.os, 'smartos');
        });

        t.end();
    });
});


test('Search image type, invalid type', function (t) {
    CLIENT.get('/my/images?type=foo', function (err, req, res, body) {
        t.ok(err);
        t.equal(res.statusCode, 409);

        t.deepEqual(body, {
            code: 'InvalidArgument',
            message: 'image type foo is not a valid type'
        });

        t.end();
    });
});


test('Search image type, results', function (t) {
    CLIENT.get('/my/images?type=smartmachine', function (err, req, res, body) {
        t.ifError(err);

        t.ok(body.length > 0);
        body.forEach(function (d) {
            checkImage(t, d);
            checkImageViewable(t, d, CLIENT);
            t.equal(d.type, 'smartmachine');
        });

        t.end();
    });
});


test('GetImage OK', function (t) {
    CLIENT.get('/my/images/' + IMAGE.id, function (err, req, res, body) {
        t.ifError(err, 'GET /my/images/' + IMAGE.id + ' error');
        t.equal(res.statusCode, 200, 'GET /my/images/:uuid status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/images/:uuid body');
        checkImage(t, body);
        t.end();
    });
});


test('GetImage - cannot access images without permission', function (t) {
    var inaccessibleImage = getInaccessibleImage(CLIENT);
    var path = '/my/images/' + inaccessibleImage.uuid;

    CLIENT.get(path, function (err, req, res, body) {
        t.ok(err);

        t.equal(res.statusCode, 404);

        t.deepEqual(body, {
            code: 'ResourceNotFound',
            message: 'image not found'
        });

        t.end();
    });
});


test('GetImage 404', function (t) {
    CLIENT.get('/my/images/' + common.uuid(), function (err) {
        t.ok(err, 'GET /my/images/ error');
        t.equal(err.statusCode, 404, 'GET /my/images/ status');
        t.equal(err.restCode, 'ResourceNotFound', 'GET /my/images/ restCode');
        t.ok(err.message, 'GET /my/images/ error message');
        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
