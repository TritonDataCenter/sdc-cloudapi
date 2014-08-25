/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert');
var util = require('util');
var restify = require('restify');


// --- Globals

var CODE = 'QuotaExceeded';
var MESSAGE = 'To have your limits raised please contact Support.';


module.exports = {
    preProvision: function (cfg) {

        if (!cfg || typeof (cfg) !== 'object') {
            throw new TypeError('cfg (object) is required');
        }

        if (!cfg.datacenter) {
            throw new TypeError('cfg.datacenter is required');
        }

        if (!cfg.defaults || typeof (cfg.defaults) !== 'object') {
            throw new TypeError('cfg.defaults (object) is required');
        }

        return function capiLimits(req, res, next) {
            // Do nothing if we are not provisioning:
            if (!(/\/machines$/.test(req.url) &&
                        req.method.toUpperCase() === 'POST')) {
                return next();
            }

            assert.ok(req.account);

            var log = req.log;

            if (req.account.isAdmin()) {
                log.debug('capi_limits: account %s is an admin, allowing.',
                    req.account.login);
                return next();
            }

            if (!req.dataset) {
                log.debug('capi_limits: no dataset on req; skipping checks.');
                return next();
            }

            return req.account.listLimits(function (err, limits) {
                if (err) {
                    log.error({err: err},
                        'capi_limits: unable to list limits.');
                    return next(new restify.InternalError(
                            'capi_limits: unable to list limits.'));
                }

                if (!limits) {
                    limits = [];
                }

                var dsname = req.dataset.name.toLowerCase();

                req.limits = limits;
                req.limit = cfg.defaults[dsname] || 2;
                var i;
                for (i = 0; i < limits.length; i++) {
                    if (limits[i].datacenter !== cfg.datacenter) {
                        continue;
                    }

                    if (limits[i][dsname]) {
                        req.limit = parseInt(limits[i][dsname], 10);
                        break;
                    }
                }

                log.info({
                    dataset: req.dataset.name,
                    limit: req.limit,
                    owner_uuid: req.account.uuid,
                    params: req.params,
                    limits: req.limits
                }, 'capi_limits: dataset limits');

                if (req.limit < 0) {
                    return next(new restify.NotAuthorizedError(
                                util.format('%s: %s', CODE, MESSAGE)));
                }

                if (req.limit === 0) {
                    log.debug('capi_limits: unlimited quota.');
                    return next();
                }

                // Note we have no way right now to filter customer machines
                // by dataset name, since that's not added at all to our VMs
                // representation on VMAPI, neither to vmadm itself.
                // In order to get a reasonably good filter, we need to query
                // IMGAPI for all the machines with a given name, then build a
                // VMAPI query including all those images UUIDs into an LDAP
                // search filter.
                return req.sdc.imgapi.listImages({
                    name: req.dataset.name,
                    state: 'all'
                }, function (err2, images, r) {
                    if (err2) {
                        log.error({err: err2},
                            'capi_limits: unable to list Images');
                    }

                    if (!images) {
                        log.info('No images found with name ' +
                            req.dataset.name);
                        return next();
                    }

                    var filter = '(&(owner_uuid=' + req.account.uuid +
                            ')(&(!(state=destroyed))(!(state=failed)))(|(' +
                    images.map(function (img) {
                        return ('image_uuid=' + img.uuid);
                    }).join(')(') + ')))';


                    log.debug({filter: filter}, 'VMAPI search machines filter');

                    return req.sdc.vmapi.client.head({
                        path: '/vms',
                        query: {query: filter}
                    }, function (err3, req3, res3) {
                        if (err3) {
                            log.error({err: err3},
                                'capi_limits: unable to count VMs.');
                            return next(new restify.InternalError(
                                    'capi_limits: unable to count VMs.'));
                        }

                        var count = Number(
                            res3.headers['x-joyent-resource-count']) || 0;

                        log.debug('capi_limits: limit=%d, count=%d',
                            req.limit, count);

                        if (count >= req.limit) {
                            return next(new restify.NotAuthorizedError(
                                    util.format('%s: %s', CODE, MESSAGE)));
                        }
                        return next();

                    });
                });
            });
        };
    }
};
