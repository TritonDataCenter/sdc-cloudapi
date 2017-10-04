/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Endpoints for managing account configuration
 */

var assert = require('assert-plus');
var jsprim = require('jsprim');
var restify = require('restify');
var schemas = require('joyent-schemas').cloudapi;
var util = require('util');

var modConfig = require('../config');


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
    req.log.info({dcName: req.config.datacenter_name, account: req.account},
        'Getting configuration');

    modConfig.getAccountDcConfigFromUFDS(req.sdc.ufds, req.account,
        req.config.datacenter_name, {
        log: req.log
    }, function _afterGetFromUFDS(err, conf) {
        if (err) {
            return next(translateErr(err));
        }

        res.send(modConfig.translateUfdsConf(conf));
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

    req.log.info({netUuids: netUuids, params: params}, 'Updating config');

    if (netUuids.indexOf(params.defaultnetwork) === -1) {
        return next(new restify.InvalidArgumentError('unknown network'));
    }

    return req.sdc.ufds.updateDcLocalConfig(account, dc, params,
            function _afterConfUpdate(err, conf) {
        if (err) {
            /*
             * If the dclocalconfig is missing, it's most likely due to a
             * race with napi-ufds-watcher. The watcher usually takes several
             * seconds after the creation of a user to create dclocalconfig.
             */
            if (err.name === 'MissingParameterError' &&
                err.message.match('dclocalconfig')) {
                return next(new restify.InternalError(
                    'Config currently unavailable.'));
            } else {
                return next(translateErr(err));
            }
        }

        res.send(modConfig.translateUfdsConf(conf));
        return next();
    });
}



///--- API


function mountConfig(server, before) {
    assert.object(server);
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
    mount: mountConfig
};
