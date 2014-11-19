/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

//
// Depending on the end-point we're hitting, we have different load options:
//
// LIST /images|/datasets || POST /machines: load only active images, we don't
// want any user creating a new machine with a disabled dataset.
//
// GET /images|/datasets/:image_uuid || GET|POST /machines/:uuid: load by UUID
// we'll try to skip loading all the images when possible.
//
// On those cases where the request has been made using image ":name" or ":urn"
// instead of ":uuid", there is no choice than try to preload all the active
// images and figure out if any of them matches the requested dataset.
//
// LIST /machines => load Active and, additionally, load deactivated too, given
// a machine could have been provisioned in the past using an Image which has
// been deactivated since then


var p = console.log;
var assert = require('assert');
var util = require('util');
var semver = require('semver');
var restify = require('restify'),
    MissingParameterError = restify.MissingParameterError,
    InvalidArgumentError = restify.InvalidArgumentError,
    ResourceNotFoundError = restify.ResourceNotFoundError;

var resources = require('./resources');
// --- Globals

var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;


// --- Helpers

/**
 * Translate an IMGAPI client error into a cloudapi response error.
 */
function errFromImgapiErr(imgapiErr) {
    var err;
    switch (imgapiErr.body.code) {
    default:
        // TODO: eventually should change to wrapping all errors from imgapi
        err = imgapiErr;
        break;
    }
    return err;
}

/**
 * Translate an IMGAPI image object with an "error" field into an error object
 * that we want to expose on cloudapi image objects. Note that the IMGAPI image
 * "error.code" values are often the set of codes from `imgadm create` in
 * the platform.
 */
function errorObjFromImgapiImage(image) {
    var e = {};
    switch (image.error.code) {
    case 'PrepareImageDidNotRun':
        /* BEGIN JSSTYLED */
        /**
         * Example:
         *  {"code": "PrepareImageDidNotRun",
         *   "message": "prepare-image script did not indicate it was run (old guest tools in VM 96c7d71c-0c62-ed29-9ee3-b765f23066b4?)"}
         */
        /* END JSSTYLED */
        e.code = image.error.code;
        e.message = image.error.message;
        // JSSTYLED
        //TODO e.url += 'http://wiki.joyent.com/wiki/display/jpc2/Troubleshooting+Image+Creation#PrepareImageDidNotRun'
        break;
    case 'VmHasNoOrigin':
        /* BEGIN JSSTYLED */
        /**
         * Example:
         *  {"code": "VmHasNoOrigin",
         *   "message": "cannot create an incremental image: vm \"593c760c-24e1-437f-d92c-a3901105f047\" has no origin"}
         */
        /* END JSSTYLED */
        e.code = image.error.code;
        e.message = image.error.message;
        // JSSTYLED
        //TODO e.url += 'http://wiki.joyent.com/wiki/display/jpc2/Troubleshooting+Image+Creation#VmHasNoOrigin'
        break;
    case 'NotSupported':
        /* BEGIN JSSTYLED */
        /**
         * Example:
         *  {"code": "NotSupported",
         *   "message": "cannot create incremental image for VM 7cfc6e0d-36e1-69de-92de-990991badadd: incremental images of incremental images are not currently supported"}
         *   "message": "cannot create an incremental image: vm \"593c760c-24e1-437f-d92c-a3901105f047\" has no origin"}
         */
        /* END JSSTYLED */
        e.code = image.error.code;
        e.message = image.error.message;
        // JSSTYLED
        //TODO e.url += 'http://wiki.joyent.com/wiki/display/jpc2/Troubleshooting+Image+Creation#NotSupported'
        break;
    default:
        e.code = 'InternalError';
        e.message = 'an unexpected error occurred '
            + '(Contact support for assistance.)';
        break;
    }
    return e;
}


function translate(req, dataset) {
    assert.ok(req);
    assert.ok(dataset);

    var obj = {
        id: dataset.uuid,
        name: dataset.name,
        version: dataset.version,
        os: dataset.os,
        requirements: {}
    };

    if (dataset.type) {
        obj.type = (dataset.type === 'zvol' ? 'virtualmachine'
                                            : 'smartmachine');
    }
    if (dataset.description) {
        obj.description = dataset.description;
    }
    if (dataset.requirements) {
        obj.requirements.password = dataset.requirements.password;
        if (dataset.requirements.max_ram) {
            obj.requirements.max_memory = dataset.requirements.max_ram;
            obj.requirements.max_ram = dataset.requirements.max_ram;
        }
        if (dataset.requirements.min_ram) {
            obj.requirements.min_memory = dataset.requirements.min_ram;
            obj.requirements.min_ram = dataset.requirements.min_ram;
        }
    }

    // Discourage use of URN, so only show it on deprecated '/datasets/...'
    // endpoints for backward compat.
    var pathname = req.getUrl().pathname;
    var isDeprecatedEndpoint = /^\/[^\/]+\/datasets/.test(pathname);
    if (dataset.urn && isDeprecatedEndpoint) {
        obj.urn = dataset.urn;
    }

    // 'X-Api-Version'-based fields.
    var v = req.getVersion();
    if (v !== '*' && semver.satisfies('6.5.0', v)) {
        // API version 6.5-only fields. The `v !== '*'` is to exclude these
        // deprecated fields if X-Api-Version isn't specified.
        obj['default'] = (req.dataset && (req.dataset.uuid === dataset.uuid));
        if (dataset.published_at) {
            obj.created = dataset.published_at;
        }
    }
    // Generally let's exclude the new fields from the /:account/datasets
    // endpoints. They are deprecated. However for backward compat, some
    // slipped into early 7.0 on JPC.
    var fields = {
        tags: true
    };
    if (!isDeprecatedEndpoint) {
        // Anything greater than or equal to 7.0.0 should have these fields:
        if (semver.satisfies('7.0.0', v) || semver.ltr('7.0.0', v)) {
            fields.homepage = true;
            fields.published_at = true;
        }
        // Likewise, everything greater than or equal to 7.1.0 must have the
        // following set of properties:
        if (semver.satisfies('7.1.0', v) || semver.ltr('7.1.0', v)) {
            fields.owner = true;
            fields['public'] = true;
            fields.state = true;
            fields.eula = true;
            fields.acl = true;
            fields.origin = true;
            fields.error = true;
        }
        // can't add fields.files since we are whitelisting the file fields here
        if (dataset.files && dataset.files.length) {
            obj.files = [ {
                compression: dataset.files[0].compression,
                sha1: dataset.files[0].sha1,
                size: dataset.files[0].size
            }];
        }
    }
    var fieldNames = Object.keys(fields);
    for (var i = 0; i < fieldNames.length; i++) {
        var field = fieldNames[i];
        if (!dataset.hasOwnProperty(field)) {
            continue;
        }

        switch (field) {
        case 'error':
            obj.error = errorObjFromImgapiImage(dataset);
            break;
        default:
            obj[field] = dataset[field];
            break;
        }
    }

    return obj;
}


function loadImage(req, cb) {
    var _d = req.params.dataset || req.params.image;
    // Intentionally not passing 'account' here, since we can be loading a
    // disabled image which was avaibale to the user at some earlier moment:
    return req.sdc.imgapi.getImage(_d, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, img) {
        if (err) {
            return cb(err);
        }
        return cb(null, img);
    });
}


function loadImages(req, cb) {
    var opts = {
        account: req.account.uuid
    };

    var pathname = req.getUrl().pathname;

    // We may be searching datasets here if end-point is either /datasets
    // or /images. Try to avoid two preload requests:
    if (!/\/machines/.test(pathname) &&
        (/\/(images|datasets)/.test(pathname) &&
        !/\/(images|datasets)\//.test(pathname))) {
        // If we have a search filter:
        if (req.params.name) {
            opts.name = req.params.name;
        }
        if (req.params.os) {
            opts.os = req.params.os;
        }
        if (req.params.version) {
            opts.version = req.params.version;
        }
        if (req.params['public']) {
            opts['public'] = req.params['public'];
        }
        if (req.params.state) {
            opts.state = req.params.state;
        }
        if (req.params.owner) {
            opts.owner = req.params.owner;
        }
        if (req.params.type) {
            opts.type = {
                'smartmachine': 'zone-dataset',
                'virtualmachine': 'zvol'
            }[req.params.type];
        }
    }
    return req.sdc.imgapi.listImages(opts, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, imgs) {
        if (err) {
            return cb(err);
        }
        return cb(null, imgs);
    });
}


// Only for machines listing!!!
function loadDisabledImages(req, cb) {
    var pathname = req.getUrl().pathname;

    if (/\/machines/.test(pathname) &&
        !/\/machines\//.test(pathname) &&
        req.method.toUpperCase() !== 'POST') {

        return req.sdc.imgapi.listImages({
            state: 'disabled'
        }, {
            headers: {
                'x-request-id': req.getId()
            }
        }, function (err, imgs) {
            if (err) {
                return cb(err);
            }
            return cb(null, imgs);
        });
    } else {
        return cb(null, []);
    }
}

function getImage(req, res, next) {
    assert.ok(req.account);
    assert.ok(req.sdc.imgapi);
    // If we tried to load dataset using URN, it should be already loaded at
    // this point:
    if (req.dataset) {
        return next();
    }
    return loadImage(req, function (err, img) {
        if (err) {
            return next(err);
        } else if (img.state === 'destroyed') {
            // Users should not see their destroyed images
            return next(new ResourceNotFoundError('%s not found', img.uuid));
        }

        req.dataset = img;
        req.log.debug({image: req.dataset}, 'selected image loaded');
        return next();
    });
}


function curImg65(req, cb) {
    var dataset, _d;
    if (req.params.dataset || req.params.image) {
        _d = req.params.dataset || req.params.image;
        dataset = req.datasets.filter(function (d) {
            if (_d === d.uuid || _d === d.urn || _d === d.name) {
                return d;
            }
            return undefined;
        });
    } else {
        dataset = req.datasets.filter(function (d) {
            if (d.name === 'smartos') {
                return d;
            }
            return undefined;
        });
    }

    if (dataset.length) {
        req.dataset = dataset.reduce(function (a, b) {
            // PUBAPI-878: semver.valid('BAD VERSION') throws since semver-2.0:
            try {
                if (semver.gte(semver.valid(a.version),
                        semver.valid(b.version))) {
                    return a;
                } else {
                    return b;
                }
            } catch (e) {
                return a;
            }
        });
        req.log.debug('load selected image %j', req.dataset);
    }
    return cb();
}

function curImg70(req, cb) {
    var imageUUID = req.params.image || req.params.dataset;
    var i;
    if (imageUUID) {
        for (i = 0; i < req.datasets.length; i++) {
            var d = req.datasets[i];
            if (imageUUID === d.uuid || imageUUID === d.urn) {
                req.dataset = d;
                req.log.debug({image: req.dataset}, 'load selected image');
                break;
            }
        }
    }
    return cb();
}


/**
 * Load `req.datasets` and `req.dataset` as appropriate for the endpoint
 * and query params.
 */
function load(req, res, next) {
    var pathname = req.getUrl().pathname;

    if (req.getUrl().pathname === '/--ping') {
        return next();
    }

    assert.ok(req.account);
    assert.ok(req.sdc.imgapi);

    req.dataset = false;
    var imageUUID = req.params.image || req.params.dataset;

    // If this is an image|dataset request by UUID, there's no need to
    // preload anything else:
    if (imageUUID && UUID_RE.test(imageUUID)) {
        return getImage(req, res, next);
    }
    // If we're trying to load a single machine, can also skip preloading:
    if (/\/machines\//.test(pathname)) {
        return next();
    }

    // Skip dataset loading and filtering if we're neither on datasets
    // or machines end-points.
    if (!/\/(datasets|machines|images)/.test(pathname)) {
        return next();
    }

    return loadImages(req, function (err, datasets) {
        if (err) {
            return next(err);
        }

        req.datasets = datasets || [];

        return loadDisabledImages(req, function (err2, imgs) {
            if (err2) {
                return next(err2);
            }

            req.datasets = req.datasets.concat(imgs);

            var loadCurFunc = (/6\.5/.test(req.getVersion())) ?
                curImg65 : curImg70;

            return loadCurFunc(req, function (err3) {
                if (err3) {
                    return next(err3);
                }
                return next();
            });
        });
    });
}

function list(req, res, next) {
    var log = req.log;
    var datasets = [];
    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }
    req.datasets.forEach(function (d) {
        return datasets.push(translate(req, d));
    });

    // Do not include any dataset w/o URN for ~6.5
    if (/6\.5/.test(req.getVersion())) {
        datasets = datasets.filter(function (d) {
            return (typeof (d.urn) !== 'undefined');
        });
    }

    log.debug('ListDatasets(%s) => %j', req.account.login, datasets);
    res.send(datasets);
    return next();
}


function get(req, res, next) {
    var log = req.log;
    var _d = req.params.dataset;
    var dataset;

    if (!req.dataset) {
        return next(new ResourceNotFoundError('%s not found', _d));
    }

    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }

    dataset = translate(req, req.dataset);

    log.debug('GetDataset(%s) => %j', req.account.login, dataset);
    res.send(dataset);
    return next();
}


function create(req, res, next) {
    var log = req.log;
    if (!req.params.machine) {
        return next(new MissingParameterError(
                    'machine is a required argument'));
    }
    if (!req.params.name) {
        return next(new MissingParameterError(
                    'Image name is a required argument'));
    }
    if (!req.params.version) {
        return next(new MissingParameterError(
                    'Image version is a required argument'));
    }

    var data = {
        name: req.params.name,
        version: req.params.version
    };

    // TODO(trentm): Review if these are appropriate attributes to be settable.
    var manifestAttributes = [
        'description',
        'homepage',
        'eula',
        'acl',
        'tags'
    ];
    manifestAttributes.forEach(function (k) {
        if (typeof (req.params[k]) !== 'undefined') {
            data[k] = req.params[k];
        }
    });

    var vm_uuid = req.params.machine;

    var createOpts = {
        vm_uuid: vm_uuid,
        incremental: true,
        headers: {
            'x-request-id': req.getId()
        }
    };
    return req.sdc.imgapi.createImageFromVm(data, createOpts, req.account.uuid,
            function (err, job, result) {
        if (err) {
            return next(errFromImgapiErr(err));
        }

        data.uuid = job.image_uuid;
        data.state = 'creating';
        log.debug('CreateImage (/%s/images) => %j', req.account.login, data);
        var locat = util.format(
                '/%s/images/%s', req.account.login, job.image_uuid);
        if (req.headers['role-tag'] || req.activeRoles) {
            // The resource we want to save is the individual one we've
            // just created, not the collection URI:
            req.resourcename = req.resourcename + '/' + job.image_uuid;
            req.resource = {
                name: req.resourcename,
                account: req.account.uuid,
                roles: []
            };
        }
        res.setHeader('x-joyent-jobid', job.job_uuid);
        res.header('Location', locat);
        res.send(201, translate(req, data));
        return next();
    });
}

function update(req, res, next) {
    var log = req.log;
    var action = req.params.action;
    var account = req.account.uuid;
    var data = {};

    if (action !== 'update') {
        return next();
    }

    var imageUUID = req.params.image || req.params.dataset;
    var updateOpts = {
        headers: {
            'x-request-id': req.getId()
        }
    };

    var validAttributes = [
        'name',
        'version',
        'description',
        'homepage',
        'eula',
        'acl',
        'tags'
    ];
    validAttributes.forEach(function (k) {
        if (req.params[k] !== undefined) {
            data[k] = req.params[k];
        }
    });

    return req.sdc.imgapi.updateImage(imageUUID, data, account, updateOpts,
            function (err, obj, result) {
        if (err) {
            return next(err);
        }

        log.debug('UpdateImage(%s) => %j %s', req.account.login, obj);
        res.send(translate(req, obj));
        return next(false);
    });
}


function exportImage(req, res, next) {
    var log = req.log;
    var action = req.params.action;
    var dataset;

    if (action !== 'export') {
        return next();
    }
    if (!req.params.manta_path) {
        return next(new MissingParameterError(
                    'Image destination manta_path is a required argument'));
    }

    var imageUUID = req.params.image || req.params.dataset;
    var exportOpts = {
        manta_path: req.params.manta_path,
        headers: {
            'x-request-id': req.getId()
        }
    };

    return req.sdc.imgapi.exportImage(imageUUID, req.account.uuid, exportOpts,
            function (err, obj, result) {
        if (err) {
            return next(err);
        }

        log.debug('ExportImage(%s) => %j %s',
            req.account.login, dataset, req.params.manta_path);
        res.send(obj);
        return next(false);
    });
}


function del(req, res, next) {
    return req.sdc.imgapi.deleteImage(
        req.dataset.uuid,
        req.account.uuid,
        {
            headers: {
                'x-request-id': req.getId(),
                'x-joyent-context': JSON.stringify({
                    caller: req._auditCtx,
                    params: req.params
                })
            }
        },
        function (err) {
            if (err) {
                return next(err);
            }
            res.send(204);
            return next();
        });
}



function mount(server, before, config) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.get({
        path: '/:account/datasets',
        name: 'ListDatasets'
    }, before, list);

    server.get({
        path: '/:account/images',
        name: 'ListImages',
        version: ['7.0.0', '7.1.0', '7.2.0']
    }, before, list);

    server.head({
        path: '/:account/datasets',
        name: 'HeadDatasets'
    }, before, list);

    server.head({
        path: '/:account/images',
        name: 'HeadImages',
        version: ['7.0.0', '7.1.0', '7.2.0']
    }, before, list);

    server.get({
        path: '/:account/datasets/:dataset',
        name: 'GetDataset'
    }, before, get);

    server.get({
        path: '/:account/images/:dataset',
        name: 'GetImage',
        version: ['7.0.0', '7.1.0', '7.2.0']
    }, before, get);

    server.head({
        path: '/:account/datasets/:dataset',
        name: 'HeadDataset'
    }, before, get);

    server.head({
        path: '/:account/images/:dataset',
        name: 'HeadImage',
        version: ['7.0.0', '7.1.0', '7.2.0']
    }, before, get);

    server.post({
        path: '/:account/images',
        name: 'CreateImageFromMachine',
        version: ['7.0.0', '7.1.0', '7.2.0']
    }, before, create, resources.updateResource);

    server.post({
        path: '/:account/images/:dataset',
        name: 'UpdateImage',
        version: ['7.0.0', '7.1.0', '7.2.0']
    }, before, update, exportImage,
        function invalidUpdateAction(req, res, next) {
            if (req.query.action) {
                return next(new InvalidArgumentError(
                    'action ' + req.query.action + ' is not a valid argument'));
            } else {
                return next(new MissingParameterError(
                    'action is a required argument'));
            }
        }, resources.updateResource);

    server.del({
        path: '/:account/images/:dataset',
        name: 'DeleteImage',
        version: ['7.0.0', '7.1.0', '7.2.0']
    }, before, del, resources.deleteResource);

    return server;
}



///--- API

module.exports = {
    load: load,
    mount: mount,
    loadImage: loadImage
};
