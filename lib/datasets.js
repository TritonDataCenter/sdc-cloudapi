// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var s = require('semver');
var restify = require('restify');



// --- Globals

var ResourceNotFoundError = restify.ResourceNotFoundError;



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

    if (/6\.5/.test(req.getVersion())) {
        obj.urn = dataset.urn;
        obj['default'] = (req.dataset && (req.dataset.uuid === dataset.uuid));
    } else {
        if (dataset.tags) {
            obj.tags = dataset.tags;
        }
    }

    return obj;
}



// --- Functions

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


function load(req, res, next) {

    assert.ok(req.account);
    assert.ok(req.sdc.imgapi);

    var log = req.log;

    req.dataset = false;

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

        var dataset, _d;
        if (req.params.dataset || req.params.image) {
            _d = req.params.dataset || req.params.image;
            dataset = req.datasets.filter(function (d) {
                if (_d === d.uuid || _d === d.urn) {
                    return d;
                }
                return undefined;
            });
        }

        if (dataset && dataset.length) {
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
    mount: mount
};
