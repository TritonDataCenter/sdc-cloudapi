// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var s = require('semver');
var restify = require('restify');



// --- Globals

var ResourceNotFoundError = restify.ResourceNotFoundError;
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;


// --- Helpers

function translate(req, dataset) {
    assert.ok(req);
    assert.ok(dataset);

    var obj = {
        id: dataset.uuid,
        name: dataset.name,
        os: dataset.os,
        type: (dataset.type === 'zvol' ? 'virtualmachine': 'smartmachine'),
        requirements: {
            password: dataset.requirements && dataset.requirements.password
        },
        version: dataset.version
    };

    if (dataset.created_at) {
        obj.created = dataset.created_at;
    }

    if (dataset.description) {
        obj.description = dataset.description;
    }

    if (dataset.requirements && dataset.requirements.max_ram) {
        obj.requirements.max_memory = dataset.requirements.max_ram;
    }

    if (dataset.requirements && dataset.requirements.min_ram) {
        obj.requirements.min_memory = dataset.requirements.min_ram;
    }

    if (dataset.urn) {
        obj.urn = dataset.urn;
    }

    if (/6\.5/.test(req.getVersion())) {
        obj['default'] = (req.dataset && (req.dataset.uuid === dataset.uuid));
    } else {
        if (dataset.tags) {
            obj.tags = dataset.tags;
        }
    }

    return obj;
}



function getImage(req, res, next) {
    assert.ok(req.account);
    assert.ok(req.sdc.imgapi);
    // If we tried to load dataset using URN, it should be already loaded at
    // this point:
    if (req.dataset) {
        return next();
    }
    var _d = req.params.dataset || req.params.image;
    // Intentionally not passing 'account' here, since we can be loading a
    // disabled image which was avaibale to the user at some earlier moment:
    return req.sdc.imgapi.getImage(_d, function (err, img) {
        if (err) {
            return next(err);
        }
        req.dataset = img;
        req.log.debug({image: req.dataset}, 'selected image loaded');
        return next();
    });
}


// --- Functions

// Different load options:
// GET /images|/datasets || POST /machines => load Active
// GET /images|/datasets/:image_uuid || GET|POST /machines/:uuid => load by UUID
// GET /machines => load Active and, when needed, load deactivated
function load_65(req, res, next) {
    var log = req.log;

    req.dataset = false;

    return req.sdc.imgapi.listImages({
        account: req.account.uuid
    }, function (err, datasets) {
        if (err) {
            return next(err);
        }

        req.datasets = datasets || [];

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
                if (s.gte(s.valid(a.version), s.valid(b.version))) {
                    return a;
                } else {
                    return b;
                }
            });
            log.debug('load selected image %j', req.dataset);
        }

        return next();
    });
}


/**
 * Load `req.datasets` and `req.dataset` as appropriate for the endpoint
 * and query params.
 */
function load(req, res, next) {
    assert.ok(req.account);
    assert.ok(req.sdc.imgapi);

    req.dataset = false;
    var imageUUID = req.params.image || req.params.dataset;
    var i;

    // If this is an image|dataset request by UUID, there's no need to
    // preload anything else:
    if (imageUUID && UUID_RE.test(imageUUID)) {
        return getImage(req, res, next);
    }

    // Skip dataset loading and filtering if we're neither on datasets
    // or machines end-points.
    if (!/\/datasets/.test(req.url) &&
        !/\/images/.test(req.url) &&
        !/\/machines/.test(req.url)) {
        return next();
    }

    if (/6\.5/.test(req.getVersion())) {
        return load_65(req, res, next);
    }

    return req.sdc.imgapi.listImages({
        account: req.account.uuid
    }, function (err, datasets) {
        if (err) {
            return next(err);
        }

        req.datasets = datasets || [];

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
        return next();
    });
}


// If we have a search filter, we want to override preloaded images with just
// those ones retrieved from IMGAPI when searching with the given filter:
function _preloadDatasets(req, cb) {
    var opts = {};
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
    // Have filter, issue the request:
    if (Object.keys(opts).length !== 0) {
        opts.account = req.account.uuid;
        return req.sdc.imgapi.listImages(opts, function (err, datasets) {
            if (err) {
                return cb(err);
            }
            req.datasets = datasets || [];
            return cb(null);
        });
    } else {
        // No filter, we're happy with the already pre-loaded stuff:
        return cb(null);
    }
}


function list(req, res, next) {
    var log = req.log;
    var datasets = [];

    return _preloadDatasets(req, function (err) {
        if (err) {
            return next(err);
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
    });
}


function get(req, res, next) {
    var log = req.log;
    var _d = req.params.dataset;
    var dataset;

    if (!req.dataset) {
        return next(new ResourceNotFoundError('%s not found', _d));
    }

    dataset = translate(req, req.dataset);

    log.debug('GetDataset(%s) => %j', req.account.login, dataset);
    res.send(dataset);
    return next();
}


function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.get({
        path: '/:account/datasets',
        name: 'ListDatasets'
    }, before, list);

    server.get({
        path: '/:account/images',
        name: 'ListImages'
    }, before, list);

    server.head({
        path: '/:account/datasets',
        name: 'HeadDatasets'
    }, before, list);

    server.head({
        path: '/:account/images',
        name: 'HeadImages'
    }, before, list);

    server.get({
        path: '/:account/datasets/:dataset',
        name: 'GetDataset'
    }, before, get);

    server.get({
        path: '/:account/images/:dataset',
        name: 'GetImage'
    }, before, get);

    server.head({
        path: '/:account/datasets/:dataset',
        name: 'HeadDataset'
    }, before, get);

    server.head({
        path: '/:account/images/:dataset',
        name: 'HeadImage'
    }, before, get);

    return server;
}



///--- API

module.exports = {
    load: load,
    mount: mount,
    getImage: getImage
};
