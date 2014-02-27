/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Provision Limits Plugin.
 *
 * See Appendix A of CloudAPI Administrator Guide for the whole details
 * on how the plugin works:
 *
 * https://mo.joyent.com/docs/cloudapi/master/admin.html
 *
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

        // In the future we may replace this with terms like "any" or "all"
        // and make possible apply the same configuration to every datacenter.
        if (!cfg.datacenter) {
            throw new TypeError('cfg.datacenter is required');
        }

        if (!cfg.defaults || typeof (cfg.defaults) !== 'object') {
            throw new TypeError('cfg.defaults (object) is required');
        }

        return function provisioningLimits(req, res, next) {
            // Do nothing if we are not provisioning, (not strictly required,
            // since CloudAPI will handle this, but illustrative):
            if (!(/\/machines$/.test(req.url) &&
                        req.method.toUpperCase() === 'POST')) {
                return next();
            }

            // This is the customer account. See node_modules/sdc-clients UFDS
            // library (lib/ufds.js) `_extendUser` method for a detailed list
            // of available properties and methods for the `account` object.
            assert.ok(req.account);

            var log = req.log;

            if (req.account.isAdmin()) {
                log.debug('Prov. limits: account %s is an admin, allowing.',
                    req.account.login);
                return next();
            }

            if (!req.dataset) {
                log.debug('Prov. limits: no dataset on req; skipping checks.');
                return next();
            }
            // If the customer account has limits, we'll use those, otherwise,
            // we'll go with the default limits specified on config
            return req.account.listLimits(function (err, limits) {
                if (err) {
                    log.error({err: err},
                        'Prov. limits: unable to list limits.');
                    return next(new restify.InternalError(
                            'Provisioning limits: unable to list limits.'));
                }

                if (!limits) {
                    limits = [];
                }
                // First, filter relevant limits from configuration (defaults):
                var cfg_limits = cfg.defaults.filter(function (l) {
                    return ((l.os && l.os === 'any') ||
                            (l.dataset && l.dataset === 'any') ||
                            (l.os && l.check && l.os === req.dataset.os &&
                                l.check === 'os') ||
                            (l.dataset && l.dataset === req.dataset.name));
                });

                log.info({cfg_limits: cfg_limits}, 'Config limits');
                // Next, filter limits, do not keep any one not relevant:
                log.info({limits: limits}, 'Customer limits before filtering');
                // First, we are only interested into limits defined for the
                // current datacenter:
                limits = limits.filter(function (l) {
                    return (l.datacenter === cfg.datacenter);
                });
                log.info({limits: limits}, 'Customer limits for this DC');
                // At this point we should have a single limits entry, let's
                // convert from capi_limits before we go further
                if (limits.length) {
                    var parsedLimits = [];
                    Object.keys(limits[0]).forEach(function (k) {
                        if (k === 'limit') {
                            limits[0][k].forEach(function (j) {
                                try {
                                    parsedLimits.push(JSON.parse(j));
                                } catch (e) {}
                            });
                        } else if (['dn',
                            'controls',
                            '_parent',
                            '_owner',
                            'objectclass',
                            'datacenter'].indexOf(k) === -1) {
                            // This is an old capi_limit: check image by
                            // number of machines:
                            parsedLimits.push({
                                image: k,
                                check: 'image',
                                by: 'machines',
                                value: limits[0][k]
                            });
                        }
                    });
                    log.info({limits: parsedLimits}, 'Customer limits parsed');
                    limits = parsedLimits;
                }

                limits = limits.filter(function (l) {
                    return ((l.os && l.os === 'any') ||
                            (l.image && l.image === 'any') ||
                            (l.os && l.check && l.os === req.dataset.os &&
                                l.check === 'os') ||
                            (l.image && l.image === req.dataset.name));
                });
                log.info({limits: limits}, 'Customer limits');

                // Next, from cfg_limits, take any limit which is different
                // than the ones from UFDS:
                cfg_limits.filter(function (cfg_l) {
                    if (!cfg_l.by) {
                        return false;
                    }
                    var exists = limits.some(function (l) {
                        return (l.check && cfg_l.check &&
                                l.check === cfg_l.check &&
                                l.os === cfg_l.os &&
                                l.by === cfg_l.by);
                    });

                    return (!exists);
                });

                // Push any limits not the same to our limits list:
                if (cfg_limits.length > 0) {
                    limits = limits.concat(cfg_limits);
                }

                log.debug({provisioning_limits: limits}, 'Limits applied.');

                req.limits = limits;
                // Then, get all the customer machines, and cache it.
                return req.account.listVmsUsage(function (err2, vms) {
                    if (err2) {
                        log.error({err: err2},
                            'Prov. limits: unable to listVmsUsage.');
                        return next(new restify.InternalError(
                            'Provision limits: unable to list VMs Usage.'));
                    }

                    log.info({vms: vms}, 'VmsUsage Values');
                    var limitExceeded = false;
                    var i;
                    for (i = 0; i < limits.length; i += 1) {
                        var limit = limits[i];
                        var value = parseInt(limit.value, 10);
                        var count;

                        if (value === 0) {
                            log.debug('Prov. limits: unlimited quota: %j',
                                limit);
                            continue;
                        }

                        switch (limit.by) {
                        case 'ram':
                            count = vms.map(function (vm) {
                                return parseInt(vm.ram, 10);
                            }).reduce(function (a, b) {
                                return (a + b);
                            }, 0) + parseInt(req.pkg.max_physical_memory, 10);
                            break;
                        case 'quota':
                            count = vms.map(function (vm) {
                                return parseInt(vm.quota, 10);
                            }).reduce(function (a, b) {
                                return (a + b);
                            }, 0) + parseInt(req.pkg.quota, 10);
                            break;
                        default: // machines
                            count = vms.length + 1;
                            break;
                        }


                        if (count > value) {
                            log.debug('Prov. limits: Limit exceeded: %j, ' +
                                    'total: %d', limit, count);
                            limitExceeded = true;
                            break;
                        }
                    }

                    if (limitExceeded === true) {
                        return next(new restify.NotAuthorizedError(
                                util.format('%s: %s', CODE, MESSAGE)));
                    } else {
                        return next();
                    }
                });
            });
        };
    }
};
