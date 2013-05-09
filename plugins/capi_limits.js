// Copyright 2012 Joyent, Inc.  All rights reserved.

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

                req.limits = limits;
                req.limit = cfg.defaults[req.dataset.name] || 0;
                for (var i = 0; i < limits.length; i++) {
                    if (limits[i].data_center !== cfg.datacenter) {
                        continue;
                    }

                    if (limits[i].type === req.dataset.name) {
                        req.limit = parseInt(limits[i].value, 10);
                        break;
                    }
                }

                log.debug({
                    dataset: req.dataset.name,
                    limit: req.limit
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
                var params = {
                    owner_uuid: req.account.uuid,
                    state: 'active'
                };

                return req.sdc.vmapi.countVms(params, function (err2, count) {
                    if (err2) {
                        log.error({err: err2},
                            'capi_limits: unable to count VMs.');
                        return next(new restify.InternalError(
                                'capi_limits: unable to count VMs.'));
                    }

                    log.debug('capi_limits: limit=%d, count=%d',
                        req.limit, count);

                    if (count >= req.limit) {
                        return next(new restify.NotAuthorizedError(
                                util.format('%s: %s', CODE, MESSAGE)));
                    }
                    return next();
                });
            });
        };
    }
};
