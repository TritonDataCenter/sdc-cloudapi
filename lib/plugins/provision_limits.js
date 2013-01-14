// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var restify = require('restify');


// --- Globals

var CODE = 'QuotaExceeded';
var MESSAGE = 'To have your limits raised please contact Support.';

// --- Configuration details:
// This plugin expects a config section with the following members:
//
//      {
//          "name": "provisioning_limits",
//          "enabled": true,
//          "config": {
//              "datacenter": ${dc_name} (String),
//              "defaults": [{
//                  "os": ${image_os} (String),
//                  "dataset": ${image_name} (String),
//                  "check": "os" | "dataset" (String),
//                  "limit_by": "ram" | "quota" | "machines" (String),
//                  "value": ${value} (Negative Integer|Zero|Positive Integer)
//              }, { ... }, ...]
//          }
//      }
//
// Likewise, this plugin makes use of UFDS 'capilimit' LDAP object to declare
// customers limits. Expected format for limit objects is similar to the format
// used by the "capi_limits" plugin, but allowing to specify either a number of
// machines or RAM or Disk Quota to establish the limit.
//
// When the value given to the attribute "limit_by" is either "ram" or "quota",
// the limit specified for these values is expected to be in Megabytes.
//
// Note that, depending on the value of the "check" member, the plugin will
// either check the limits against the dataset family (centos, ubuntu, ...),
// like the "capi_limits" plugin does when the value is "dataset", or will
// just check by dataset operating system when the given value is "os".
//
// For example:
//
//      dn: dclimit=coal, uuid=36fa9832-b836-455d-ac05-c586512019e4, \
//          ou=users, o=smartdc
//      datacenter: coal
//      objectclass: capilimit
//      type: smartos
//      os: smartos
//      check: dataset
//      by: machines
//      value: 1
//
// This would be a different configuration, which would limit provisioning
// by disk "quota", and take a value of Infinity for the current customer:
//
//      dn: dclimit=coal, uuid=24c0ee76-9313-4a2c-b6e7-c46dbf769f00, \
//          ou=users, o=smartdc
//      datacenter: coal
//      objectclass: capilimit
//      type: ubuntu
//      os: linux
//      check: os
//      by: quota
//      value: 0
//
// And, finally, there is an example of the same plugin limiting provisions by
// 50 GB of "ram":
//
//      dn: dclimit=coal, uuid=4e4f53d0-613e-463e-965f-1c1a50c0d8e1, \
//          ou=users, o=smartdc
//      datacenter: coal
//      objectclass: capilimit
//      type: windows
//      os: windows
//      check: os
//      by: ram
//      value: 51200
//
// Note that, as for "capi_limits", a "value" of zero means unlimited
// quota.
//
// Also, note that is perfectly possible to specify several limits which may
// be related to the same dataset/os like, for example, check that there are a
// maximum of 3 machines with the given dataset/os and a total RAM of 1280MB,
// in a way that 3 machines of 128MB each would be perfectly valid, but 4
// machines will not, neither will be 2 machines of 1024MB each.
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
                // Next, filter limits, do not keep any one not relevant:
                limits = limits.filter(function (l) {
                    return ((l.os && l.os === 'any') ||
                            (l.dataset && l.dataset === 'any') ||
                            (l.os && l.check && l.os === req.dataset.os &&
                                l.check === 'os') ||
                            (l.dataset && l.dataset === req.dataset.name));
                });
                // Next, from cfg_limits, take any limit which is different
                // than the ones from UFDS:
                cfg_limits.filter(function (cfg_l) {
                    if (!cfg_l.by) {
                        return false;
                    }
                    var exists = limits.some(function (l) {
                        return ((l.check && l.check === 'os' &&
                                    l.os === cfg_l.os && l.by === cfg_l.by) ||
                                (l.check && l.check === 'dataset' &&
                                    l.dataset === cfg_l.dataset &&
                                    l.by === cfg_l.by));
                    });

                    return (!exists);
                });

                // Push any limits not the same to our limits list:
                if (cfg_limits.length > 0) {
                    limits = limits.concat(cfg_limits);
                }

                req.limits = limits;
                // Then, get all the customer machines, and cache it.
                return req.account.listVmsUsage(function (err2, vms) {
                    if (err2) {
                        log.error({err: err2},
                            'Prov. limits: unable to listVmsUsage.');
                        return next(new restify.InternalError(
                            'Provision limits: unable to list VMs Usage.'));
                    }



                    var limitExceeded = false;
                    for (var i = 0; i < limits.length; i += 1) {
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
