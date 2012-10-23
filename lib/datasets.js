// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var s = require('semver');
var restify = require('restify');



// --- Globals

var ResourceNotFoundError = restify.ResourceNotFoundError;



// --- Helpers

function translate(dataset) {
    assert.ok(dataset);

    var obj = {
        id: dataset.uuid,
        urn: dataset.urn,
        name: dataset.name,
        os: dataset.os,
        type: (dataset.type === 'zvol' ? 'virtualmachine': 'smartmachine'),
        description: dataset.description,
        'default': dataset['default'],
        requirements: {
            password: dataset.requirements && dataset.requirements.password
        },
        version: dataset.version,
        created: dataset.created_at
    };

    if (dataset.requirements && dataset.requirements.max_ram) {
        obj.requirements.max_memory = dataset.requirements.max_ram;
    }

    if (dataset.requirements && dataset.requirements.min_ram) {
        obj.requirements.min_memory = dataset.requirements.min_ram;
    }

    return obj;
}



// --- Functions

function load(req, res, next) {
    assert.ok(req.account);
    assert.ok(req.sdc.imgapi);

    var log = req.log;

    req.dataset = false;

    // Skip dataset loading and filtering if we're neither on datasets
    // or machines end-points.
    if (!/\/datasets/.test(req.url) && !/\/machines/.test(req.url)) {
        return next();
    }

    return req.sdc.imgapi.listImages({}, function (err, datasets) {
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


function list(req, res, next) {
    var log = req.log,
        datasets = req.datasets.map(translate);

    log.debug('ListDatasets(%s) => %j', req.account.login, datasets);
    res.send(datasets);
    return next();
}


function get(req, res, next) {
    var log = req.log,
        _d = req.params.dataset,
        dataset;

    if (!req.dataset) {
        return next(new ResourceNotFoundError('%s not found', _d));
    }

    dataset = translate(req.dataset);

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
