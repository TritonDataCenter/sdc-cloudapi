/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Endpoints for managing account configuration
 */

var assert = require('assert');
var jsprim = require('jsprim');
var restify = require('restify');
var schemas = require('joyent-schemas').cloudapi;
var util = require('util');



// --- Helpers



/**
 * Translate a UFDS error into a cloudapi-friendly error
 */
function translateErr(err) {
    if (err.name === 'ResourceNotFoundError') {
        return new restify.ServiceUnavailableError(
            'Error getting config');
    }

    return err;
}


/**
 * Translate the UFDS representation of a default network into a
 * cloudapi-friendly format
 */
function translateUfdsConf(conf) {
    return {
        default_network: conf.defaultnetwork
    };
}


/**
 * Validate request parameters and transform them into their UFDS format
 */
function validateAndTranslate(inParams) {
    var err;
    var params = jsprim.deepCopy(inParams);
    delete params.account;

    err = jsprim.validateJsonObject(schemas.UpdateConfig, params);
    if (err) {
        if (err.message.match(/does not match the regex pattern/)) {
            throw new restify.InvalidArgumentError(err,
                    util.format('property "%s": must be a UUID',
                    err.jsv_details.property));
        }

        throw new restify.InvalidArgumentError(err, err.message);
    }

    // Translate config object to its format in UFDS:
    params.defaultnetwork = params.default_network;
    delete params.default_network;

    return params;
}



// --- Restify handlers



function getConfig(req, res, next) {
    getConfigFromUFDS(req, function _afterGetFromUFDS(err, conf) {
        if (err) {
            return next(err);
        }

        res.send(conf);
        return next();
    });
}


function updateConfig(req, res, next) {
    var account = req.account.uuid;
    var dc = req.config.datacenter_name;
    var netUuids = req.networks.map(function (n) { return n.uuid; });
    var params;

    try {
        params = validateAndTranslate(req.params);
    } catch (vErr) {
        return next(vErr);
    }

    if (netUuids.indexOf(params.defaultnetwork) === -1) {
        return next(new restify.InvalidArgumentError('unknown network'));
    }

    return req.sdc.ufds.updateDcLocalConfig(account, dc, params,
            function _afterConfUpdate(err, conf) {
        if (err) {
            return next(translateErr(err));
        }

        res.send(translateUfdsConf(conf));
        return next();
    });
}



///--- API


function getConfigFromUFDS(req, callback) {
    var account = req.account.uuid;
    var dc = req.config.datacenter_name;

    req.log.debug({ account: account, dc: dc }, 'Getting user config');

    req.sdc.ufds.getDcLocalConfig(account, dc,
            function _afterConfGet(err, conf) {
        if (err) {
            return callback(translateErr(err));
        }

        req.log.debug({ account: account, dc: dc, config: conf },
            'Got user config');
        return callback(null, translateUfdsConf(conf));
    });
}


function mountConfig(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    var path = '/:account/config';

    server.get({
        path: path,
        name: 'GetConfig'
    }, before, getConfig);

    server.head({
        path: path,
        name: 'HeadConfig'
    }, before, getConfig);

    server.put({
        path: path,
        name: 'UpdateConfig'
    }, before, updateConfig);

    return server;
}



module.exports = {
    get: getConfigFromUFDS,
    mount: mountConfig
};
