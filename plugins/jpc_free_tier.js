/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * JPC Free Tier offering plugin.
 *
 * Each JPC account can create a single free tier instance per
 * datacenter for the first year after the account has been created.
 *
 * Free tier instance: req.package has one of the uuids listed into
 * plugin config file.
 *
 * First year after the account has been created: lookup at
 * req.account.created_at (epoch time), and compare with "one year ago".
 *
 * Single instance: count VMAPI vms into the current DC, (only those
 * whose state wasn't "failed").
 */


var assert = require('assert');
var util = require('util');
var restify = require('restify');

var CODE = 'QuotaExceeded';
var MESSAGE = 'Free tier offering is limited to a single instance for the ' +
                'first year after the account has been created.';

function leap(year) {
    return ((year % 4) === 0 &&
            ((year % 100) !== 0 || (year % 400) === 0));
}

// Epoch time for one year ago:
function oneYearAgo() {
    var d = new Date();
    var y = d.getFullYear();
    var days = leap(y) ? 366 : 365;
    return (d - (days * 24 * 60 * 60 * 1000));
}

module.exports = {
    preProvision: function (cfg) {

        if (!cfg || typeof (cfg) !== 'object') {
            throw new TypeError('cfg (object) is required');
        }

        if (!cfg.packages) {
            throw new TypeError('cfg.packages is required');
        }

        return function jpcFreeTier(req, res, next) {
            // Do nothing if we are not provisioning:
            if (!(/\/machines$/.test(req.url) &&
                        req.method.toUpperCase() === 'POST')) {
                return next();
            }

            assert.ok(req.account);
            assert.ok(req.sdc);
            assert.ok(Array.isArray(cfg.packages));

            var log = req.log;

            if (!req.pkg) {
                log.debug('jpc_free_tier: no package on req; skipping checks.');
                return next();
            }

            // If req.package is not included into the free tier config list,
            // this plugin should have zero impact in provisioning:
            if (cfg.packages.indexOf(req.pkg.uuid) === -1) {
                log.debug('jpc_free_tier: pkg %s is not free tier, allowing.',
                    req.pkg.uuid);
                return next();

            }
            if (req.account.isAdmin()) {
                log.debug('jpc_free_tier: account %s is an admin, allowing.',
                    req.account.login);
                return next();
            }

            // If the account is older than one year, we don't need to lookup
            // anything else
            var created = new Date(req.account.created_at);
            var aYearAgo = new Date(oneYearAgo());
            if (created <= aYearAgo) {
                log.info('jpc_free_tier: account %s created %s, disallowing.',
                        req.account.login, created.toUTCString());
                return next(new restify.NotAuthorizedError(
                                util.format('%s: %s', CODE, MESSAGE)));
            }


            // Let's assume we will allow destroy/re-create a machine for
            // the free tier time period
            var filter = '(&(owner_uuid=' + req.account.uuid +
                    ')(&(!(state=destroyed))(!(state=failed))))';


            log.debug({filter: filter}, 'VMAPI search machines filter');

            return req.sdc.vmapi.client.head({
                path: '/vms',
                query: {query: filter}
            }, function (err3, req3, res3) {
                if (err3) {
                    log.error({err: err3},
                        'jpc_free_tier: unable to count VMs.');
                    return next(new restify.InternalError(
                            'jpc_free_tier: unable to count VMs.'));
                }

                var count = Number(
                    res3.headers['x-joyent-resource-count']) || 0;

                log.debug('jpc_free_tier: limit=1, count=%d', count);

                if (count !== 0) {
                    log.info('jpc_free_tier: %s instances, disallowing.',
                        count);
                    return next(new restify.NotAuthorizedError(
                            util.format('%s: %s', CODE, MESSAGE)));
                }

                return next();

            });

        }
    }
};
