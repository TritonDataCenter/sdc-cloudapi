/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

var jsprim = require('jsprim');
var util = require('util');
var vasync = require('vasync');

var common = require('../common');


// --- Globals

// --- Tests for image sharing and image cloning.

module.exports = function ImageCloneTestSuite(suite, clients) {
    var client = clients.user;
    var clonedImg;
    var customImg;
    var other = clients.other;
    var setupWasSuccessful = false;
    var test = suite.test;
    var testImg;

    /**
     * Test setup
     *
     * In order to test image sharing - we first need to create an imgapi image
     * that is owned by our test user (and make it a private image). We do this
     * by taking an existing public image and manually copy it into the users
     * own custom image.
     */

    test('Image clone setup', function _setup(t) {
        vasync.pipeline({ arg: {}, funcs: [
            function getImage(_, next) {
                common.getTestImage(client, function _getTestImgCb(err, img) {
                    t.ifError(err, 'Image sharing: getTestImage');
                    testImg = img;
                    next(err);
                });
            },
            function getImageFileStream(ctx, next) {
                client.imgapi.getImageFileStream(testImg.id,
                        function _getImageFileStreamCb(err, stream) {
                    t.ifError(err, 'Image sharing: getImageFileStream');
                    // Stream has to be paused, for addImageFile call.
                    if (stream) {
                        stream.pause();
                        ctx.filestream = stream;
                    }
                    next(err);
                });
            },
            function createCustomImage(ctx, next) {
                var newImgManifest = jsprim.deepCopy(testImg);
                newImgManifest.owner = client.account.uuid;
                newImgManifest.public = false;
                delete newImgManifest.id;
                delete newImgManifest.state;
                delete newImgManifest.files;
                delete newImgManifest.published_at;
                client.imgapi.createImage(newImgManifest,
                        function _createImageCb(err, newImg) {
                    t.ifError(err, 'Image sharing: createCustomImage');
                    customImg = newImg;
                    next(err);
                });
            },
            function imgapiImportImageFile(ctx, next) {
                var file = testImg.files[0];
                var opts = {
                    compression: file.compression,
                    file: ctx.filestream,
                    sha1: file.sha1,
                    size: file.size,
                    storage: 'local',
                    uuid: customImg.uuid
                };
                client.imgapi.addImageFile(opts, next);
            },
            function imgapiActivateImage(ctx, next) {
                client.imgapi.activateImage(customImg.uuid, next);
            }
        ]}, function _setupPipelineCb(err) {
            if (err) {
                t.fail('Image clone setup unsuccessful: ' + err);
            } else {
                setupWasSuccessful = true;
            }
            t.end();
        });
    });

    function checkSetupSuccessful(t) {
        if (!setupWasSuccessful) {
            t.fail('Image sharing setup was unsuccessful');
            t.end();
            return false;
        }
        return true;
    }

    /* Before the image is shared - other user should not be able to clone it */
    test('Image clone no access', function testImageCloneNoAccess(t) {
        if (!checkSetupSuccessful(t)) {
            return;
        }

        var data = {};
        other.post(util.format('/my/images/%s?action=clone', customImg.uuid),
                data, function _testImageCloneNoAccessCb(err, req, res, img) {
            t.ok(err, 'should get an err on image clone without access');
            t.equal(res.statusCode, 404, 'res.statusCode');
            t.end();
        });
    });

    test('Image share', function testImageShare(t) {
        if (!checkSetupSuccessful(t)) {
            return;
        }

        var data = {
            acl: [ other.account.uuid ]
        };
        client.post(util.format('/my/images/%s?action=update', customImg.uuid),
                data, function _testImageShareCb(err, req, res, img) {
            t.ifError(err, 'no err on image share with other user');
            t.equal(res.statusCode, 200, 'res.statusCode');
            t.ok(img, 'expect an image response object');
            if (img) {
                t.ok(Array.isArray(img.acl), 'image has an ACL array');
                t.ok(img.acl.indexOf(other.account.uuid) >= 0,
                    'image ACL now contains other account');
            }
            t.end();
        });
    });

    test('Image clone', function testImageClone(t) {
        if (!checkSetupSuccessful(t)) {
            return;
        }

        var data = {};
        other.post(util.format('/my/images/%s?action=clone', customImg.uuid),
                data, function _testImageCloneCb(err, req, res, img) {
            t.ifError(err, 'no err on image share with other user');
            t.equal(res.statusCode, 200, 'res.statusCode');
            t.ok(img, 'expect an image response object');
            if (img) {
                t.notEqual(img.id, customImg.uuid, 'cloned image has own id');
                t.ok(!img.acl, 'image should not have an ACL');
                clonedImg = img;
            }
            t.end();
        });
    });

    test('No access to the cloned image for original user',
            function testCloneNoAccessClonedImage(t) {
        if (!checkSetupSuccessful(t)) {
            return;
        }

        client.post(util.format('/my/images/%s?action=clone', clonedImg.uuid),
                {}, function _testCloneNoAccessClonedImageCb(err, req, res) {
            t.ok(err, 'should get an err on image clone without access');
            t.equal(res.statusCode, 404, 'res.statusCode');
            t.end();
        });
    });

    test('Error when deleting the cloned image as original user',
            function testCloneDeleteAsOther(t) {
        if (!checkSetupSuccessful(t)) {
            return;
        }

        client.del(util.format('/my/images/%s', clonedImg.id),
                function _testCloneDeleteAsOtherCb(err) {
            t.ok(err, 'should be an error trying to delete');
            t.end();
        });
    });

    test('Delete the cloned image as clone user',
            function testCloneDeleteAsOwner(t) {
        if (!checkSetupSuccessful(t)) {
            return;
        }

        other.del(util.format('/my/images/%s', clonedImg.id),
                function _testCloneDeleteAsOwnerCb(err) {
            t.ifError(err, 'check for delete cloned image err');
            t.end();
        });
    });

    test('Recheck original image', function testCheckOriginalImage(t) {
        if (!checkSetupSuccessful(t)) {
            return;
        }

        client.get(util.format('/my/images/%s', customImg.uuid),
                function _testCheckOriginalImageCb(err, req, res, img) {
            t.ifError(err, 'should be no err on image get');
            t.ok(img, 'expect an image response object');
            t.end();
        });
    });

    test('Image clone teardown', function testCloneImageTeardown(t) {
        t.end();
        suite.end();
    });
};
