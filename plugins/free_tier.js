/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * Free Tier offering plugin: each account can create a single free-tier
 * instance per datacenter for the first year after the account has been
 * created.
 *
 * To configure this plugin, add the UUIDs of the packages that are used for the
 * free tier; exactly one free allocation will be allowed from this set of
 * packages:
 *
 * {
 *    "name": "free_tier",
 *    "enabled": true,
 *    "config": {
 *        "packages": [ ... list of UUIDs here ... ],
 *    }
 * }
 *
 * This is added to CLOUDAPI_PLUGINS and DOCKER_PLUGINS, serialized to JSON, and
 * PUT to cloudapi's and sdc-docker's sapi services. E.g.:
 *
 * sdc-sapi /services/$(sdc-sapi /services?name=cloudapi | json -Ha uuid) -X PUT
 * -d '{
 *    "metadata": {
 *         "CLOUDAPI_PLUGINS": "[{\"name\":\"free_tier\", \
 *         \"enabled\": true, \"config\": {\"packages\": \
 *         [\"fb7f31ad-52d6-4e92-83d2-9f9d94ceef3f\"]}}]"
 *    }
 * }'
 */


var assert = require('assert-plus');


// --- Globals


var QUOTA_ERR = 'QuotaExceeded; free tier offering is limited to a single ' +
    'instance for the first year after the account has been created';

var YEAR_IN_MS = 365.25 * 24 * 60 * 60 * 1000;


/*
 * Calls cb(err), where no error means that the provision can proceed. An error
 * should halt the provision.
 */
function allowOneYearFreeTier(api, cfg) {
    assert.object(api, 'api');
    assert.object(api.log, 'api.log');
    assert.object(cfg, 'cfg');
    assert.arrayOfUuid(cfg.packages, 'cfg.packages');

    var log = api.log;
    var packageUuids = cfg.packages;

    return function checkOneYearFreeTier(opts, cb) {
        assert.object(opts, 'opts');
        assert.object(opts.account, 'opts.account');
        assert.object(opts.pkg, 'opts.pkg');
        assert.uuid(opts.req_id, 'opts.req_id');
        assert.func(cb, 'cb');

        log.debug('Running', checkOneYearFreeTier.name);

        var account = opts.account;

        // If requested package is not in the free tier config list, this plugin
        // should have no impact on provisioning:
        if (packageUuids.indexOf(opts.pkg.uuid) === -1) {
            log.debug('Pkg %s is not free tier; allowing', opts.pkg.uuid);
            return cb();
        }

        if (account.isAdmin()) {
            log.debug('Account %s is an admin; allowing', account.login);
            return cb();
        }

        // If the account is older than one year, disallow.
        var created = new Date(account.created_at);
        if (created < Date.now() - YEAR_IN_MS) {
            log.info('Account %s created more than one year ago; disallowing',
                account.login);
            return cb(new api.NotAuthorizedError(QUOTA_ERR));
        }

        return api.getActiveVmsForAccount({
            account: account,
            fields: 'billing_id',
            req_id: opts.req_id
        }, function (err, vms) {
            if (err) {
                log.error({ err: err }, 'Unable to count VMs');
                return cb(err);
            }

            var count = vms.filter(function (vm) {
                return packageUuids.indexOf(vm.billing_id) !== -1;
            }).length;

            if (count > 0) {
                log.info('%s free instances; disallowing', count);
                return cb(new api.NotAuthorizedError(QUOTA_ERR));
            }

            return cb();
        });
    };
}


module.exports = {
    allowProvision: allowOneYearFreeTier
};
