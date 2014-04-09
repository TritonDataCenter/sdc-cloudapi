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
var vasync = require('vasync');

// --- Globals

var CODE = 'QuotaExceeded';
var MESSAGE = 'To have your limits raised please contact Support.';


/*
 * Separated function in order to make testing easier.
 *
 * Unique task for this function is to return which limits will be
 * applied for a given customer. Required information for the function includes
 * the specific limits, the global limits and the image which will be used for
 * provisioning. All this information can be obtained from the request object.
 *
 * Please, note this function will just return an array with the limits to be
 * applied for the given request, even if that array is empty.
 */
function filterLimits(req_image, cfg_limits, limits) {

    // First, filter relevant limits from configuration (defaults):
    cfg_limits = cfg_limits.filter(function (l) {
        return ((l.os && l.os === 'any') ||
                (l.image && l.image === 'any') ||
                (l.os && l.check && l.os === req_image.os &&
                    l.check === 'os') ||
                (l.image && (l.image === req_image.name ||
                    l.image === req_image.name.toLowerCase())));
    });


    // At this point we should have a single limits entry, let's
    // convert from capi_limits before we go further
    if (limits.length) {
        var parsedLimits = [];
        Object.keys(limits[0]).forEach(function (k) {
            if (k === 'limit') {
                if (typeof (limits[0][k]) === 'string') {
                    limits[0][k] = [limits[0][k]];
                }
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
        limits = parsedLimits;
    }

    limits = limits.filter(function (l) {
        return ((l.os && l.os === 'any') ||
                (l.image && l.image === 'any') ||
                (l.os && l.check && l.os === req_image.os &&
                    l.check === 'os') ||
                (l.image && (l.image === req_image.name.toLowerCase() ||
                            l.image === req_image.name)));
    });
    // Check if the customer has a 'catch all' limit specified and, if so
    // skip adding anything from the cfg_limits:
    var catchAll = limits.some(function (l) {
        return ((l.os && l.os === 'any') || (l.image && l.image === 'any'));
    });

    // Next, from cfg_limits, take any limit which is different
    // than the ones from UFDS:
    cfg_limits.filter(function (cfg_l) {
        if (!cfg_l.by) {
            return false;
        }
        var exists = limits.some(function (l) {
            return (l.check && cfg_l.check &&
                    l.check === cfg_l.check &&
                    l.by === cfg_l.by);
        });

        return (!exists);
    });

    // Push any limits not the same to our limits list:
    if (cfg_limits.length > 0 && !catchAll && limits.length === 0) {
        limits = limits.concat(cfg_limits);
    }
    return (limits);
}

module.exports = {
    filterLimits: filterLimits,
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
                // First, we are only interested into limits defined for the
                // current datacenter:
                limits = limits.filter(function (l) {
                    return (l.datacenter === cfg.datacenter);
                });
                limits = filterLimits(req.dataset, cfg.defaults, limits);
                log.debug({provisioning_limits: limits},
                        'Limits to be applied.');

                // Before we attempt to fetch anything from VMAPI there are
                // still several things we can do in order to fail/allow early:
                // - If at this point we have any limit with a value of "-1",
                // this means we will not be able to provision, since this one
                // will be applied and we should return now with a failure.
                if (limits.some(function (a) {
                    return (a.value && parseInt(a.value, 10) <= -1);
                })) {
                    log.info('Prov. Limits: Limits with negative value ' +
                            'applied, dissallowing');
                    return next(new restify.NotAuthorizedError(
                                util.format('%s: %s', CODE, MESSAGE)));
                }
                // - If we have any limit with a value of zero, we'll simply
                // allow so we could safely remove those values from the list.
                limits = limits.filter(function (a) {
                    return (a.value && parseInt(a.value, 10) !== 0);
                });
                // - Make sure we have at least one limit or return now with
                // an OK.
                if (!limits.length) {
                    log.debug('Prov. limits: no limits to be applied, ' +
                            'allowing.');
                    return next();
                }
                req.limits = limits;

                // Now, we have to:
                // - load all images with same os than req.dataset. (We will
                // optimize and just return those with same name than current
                // image if there isn't any "check": "os" limit)
                // - get all the customer machines whose state is not destroyed
                // or failed.
                // - check pending limits
                var toCheck = 'image';
                var images = [];
                var allVms = [];
                // Vms with same OS:
                var osVms = [];
                // Vms with same image:
                var imgVms = [];

                function whatToCheck(_, cb) {
                    if (req.limits.some(function (x) {
                        return (x.check === 'os');
                    })) {
                        toCheck = 'os';
                    }
                    cb(null);
                }

                function fetchImages(_, cb) {
                    var opts = {
                        state: 'all'
                    };

                    if (toCheck === 'image') {
                        opts.name = req.dataset.name;
                    } else {
                        opts.os = req.dataset.os;
                    }

                    req.sdc.imgapi.listImages(opts, function (er, imgs, r) {
                        if (er) {
                            log.error({err: er},
                            'Prov. limits: unable to list Images');
                            return cb(er);
                        }

                        if (!imgs) {
                            log.error('Prov. limits: No Images found!');
                            return cb(new Error('No images found'));
                        }

                        images = imgs;
                        return cb(null);
                    });
                }

                function loadActiveMachines(_, cb) {
                    var filter = '(&(owner_uuid=' + req.account.uuid +
                            ')(&(!(state=destroyed))(!(state=failed))))';
                    req.sdc.vmapi.listVms({
                        query: filter
                    }, function (er, vms) {
                        if (er) {
                            log.error({err: er},
                            'Prov. limits: unable to list VMs');
                            return cb(er);
                        }

                        allVms = vms.map(function (vm) {
                            images.filter(function (i) {
                                if (i.uuid === vm.image_uuid ||
                                    (vm.brand === 'kvm' &&
                                    i.uuid === vm.disks[0].image_uuid)) {
                                    vm.image_name = i.name;
                                    vm.os = i.os;
                                }
                            });
                            return (vm);
                        });

                        return cb(null);
                    });
                }

                function machinesByOs(_, cb) {
                    osVms = allVms.filter(function (vm) {
                        return (vm.os && vm.os === req.dataset.os);
                    });

                    return cb(null);
                }

                function machinesByImg(_, cb) {
                    imgVms = allVms.filter(function (vm) {
                        return (vm.image_name &&
                            (vm.image_name === req.dataset.name ||
                            vm.image_name.toLowerCase() === req.dataset.name));
                    });

                    return cb(null);
                }

                return vasync.pipeline({
                    funcs: [whatToCheck, fetchImages, loadActiveMachines,
                            machinesByOs, machinesByImg]
                }, function (er, results) {
                    if (er) {
                        log.error({err: er},
                            'Prov. limits: unable to get machines/images');
                        return next(new restify.InternalError(
                                'Prov. limits: unable to get machines/images'));
                    }

                    return vasync.forEachPipeline({
                        inputs: req.limits,
                        func: function (limit, cb) {
                            log.debug({limit: limit}, 'Applying limit');
                            var value = parseInt(limit.value, 10);
                            if (value === 0) {
                                return cb(null);
                            }
                            var count;
                            var machines = allVms;

                            if (limit.check === 'os' && limit.os !== 'any') {
                                machines = osVms;
                            }

                            if (limit.check === 'image' &&
                                limit.image !== 'any') {
                                machines = imgVms;
                            }

                            switch (limit.by) {
                            case 'ram':
                                count = machines.map(function (vm) {
                                    return parseInt(vm.ram, 10);
                                }).reduce(function (a, b) {
                                    return (a + b);
                                }, 0) + parseInt(
                                    req.pkg.max_physical_memory, 10);
                                break;
                            case 'quota':
                                count = machines.map(function (vm) {
                                    return parseInt(vm.quota, 10);
                                }).reduce(function (a, b) {
                                    return (a + b);
                                }, 0) + parseInt(req.pkg.quota, 10);
                                break;
                            default: // machines
                                count = machines.length + 1;
                                break;
                            }

                            if (count > value) {
                                log.info({limit: limit},
                                        'Provisioning limit applied');
                                return cb(new restify.NotAuthorizedError(
                                    util.format('%s: %s', CODE, MESSAGE)));
                            }

                            return cb(null);
                        }
                    }, function (er2, results2) {
                        if (er2) {
                            return next(er2);
                        }

                        return next();

                    });
                });
            });
        };
    }
};
