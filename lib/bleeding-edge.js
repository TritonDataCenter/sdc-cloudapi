/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Utility functions to guard bleeding-edge features and make them selectively
 * available to some users, based into configuration values
 * bleeding_edge_features and bleeding_edge_login_whitelist.
 */

var assert = require('assert');
var restify = require('restify'),
    ResourceNotFoundError = restify.ResourceNotFoundError;


/**
 * Guard an endpoint based on `config.bleeding_edge_features` and
 * `config.bleeding_edge_login_whitelist`.
 *
 * Usually, you want to call this function within the `mount` function for
 * your resource as part of the "before" chain for any end-point you want to
 * guard. It's to say, this function must be called before the one which
 * actually performs your end-point logic. For example, for a new feature
 * called "very_latest", handled by a function called "endPoint" which will
 * be mounted on the route "GET /:account/end-point":
 *
 * server.get({
 *      path: '/:account/end-point',
 *      name: 'EndPointToBeTested',
 *      version: ['7.9.9']
 * }, bleedingEdgeGuard(config, 'very_latest'), before, endPoint)
 *
 */
function bleedingEdgeGuard(config, feature) {

    if (config.bleeding_edge_features &&
        config.bleeding_edge_features[feature])
    {
        return function bleedingEdgeFeature(req, res, next) {
            if (config.bleeding_edge_login_whitelist &&
                (config.bleeding_edge_login_whitelist[req.account.login] ||
                config.bleeding_edge_login_whitelist['*']))
            {
                next(); // allow
            } else {
                next(new ResourceNotFoundError('%s does not exist', req.url));
            }
        };
    } else {
        return function bleedingEdgeHide(req, res, next) {
            next(new ResourceNotFoundError('%s does not exist', req.url));
        };
    }
}

module.exports = {
    bleedingEdgeGuard: bleedingEdgeGuard
};
