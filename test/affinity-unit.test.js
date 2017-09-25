/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Affinity rule *unit* tests.
 * See machines/affinity.test.js for integration tests.
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');
var deepEqual = require('tape/node_modules/deep-equal');
var test = require('tape').test;
var util = require('util');
var VError = require('verror');
var XRegExp = require('xregexp');

var lib_affinity = require('../lib/triton-affinity');


var log = bunyan.createLogger({
    level: process.env.LOG_LEVEL || 'warn',
    name: 'sdccloudapitest-affinity-unit',
    stream: process.stderr,
    serializers: bunyan.stdSerializers
});


// ---- helpers

/*
 * Pass in an array of server objects with a 'vms' array that is the set of
 * VMs on that server *for the single unnamed account*.
 */
function MockDc(servers) {
    assert.arrayOfObject(servers, 'servers');
    var self = this;

    this.servers = servers;

    this.vms = [];
    this.vmFromUuid = {};
    this.vmFromAlias = {};
    this.serverFromUuid = {};

    servers.forEach(function (server) {
        self.serverFromUuid[server.uuid] = server;
        server.vms.forEach(function (vm) {
            vm.server_uuid = server.uuid;
            self.vms.push(vm);
            self.vmFromUuid[vm.uuid] = vm;
            self.vmFromAlias[vm.alias] = vm;
        });
    });
}

/*
 * Faking out `triton-affinity._vmsFromRule`.
 *      {
 *          key: 'instance',
 *          value: 'webhead*',
 *          valueType: 'glob',  // or 're' or 'exact'
 *          ...
 *      }
 *
 * Limitations:
 * - Not bothering with docker_id matching.
 */
MockDc.prototype.vmsFromRule = function (rule) {
    var self = this;
    var key = rule.key;
    var val = rule.value;
    var valueType = rule.valueType;
    var valueRe;
    var vms = [];

    if (valueType === 'exact') {
        valueRe = new RegExp('^' + XRegExp.escape(val) + '$');
    } else if (valueType === 'glob') {
        // Cheat. Better would be to use minimatch.
        valueRe = new RegExp(
            '^'
            + XRegExp.escape(val)
                .replace('\\*', '.*')
                .replace('\\?', '.')
            + '$');
    } else if (valueType === 're') {
        valueRe = rule.valueRe;
    } else {
        throw new VError('unexpected rule data', rule);
    }

    if (key === 'instance' || key === 'container') {
        // exact uuid
        if (valueType === 'exact' && self.vmFromUuid[val]) {
            vms.push(self.vmFromUuid[val]);
        } else {
            // alias
            self.vms.forEach(function (vm) {
                if (vm.alias && valueRe.test(vm.alias)) {
                    vms.push(vm);
                }
            });
        }
    } else {
        // tag
        self.vms.forEach(function (vm) {
            if (vm.tags && vm.tags.hasOwnProperty(key) &&
                valueRe.test(vm.tags[key].toString()))
            {
                vms.push(vm);
            }
        });
    }

    return vms;
};


function assertLocalityFromRules(opts) {
    var i;
    var expectedLocality;
    var foundMatch;
    var locality;
    var locSummary;
    var rulesInfo = [];

    opts.exprs.forEach(function (expr) {
        var rule = lib_affinity.ruleFromExpr(expr);
        // .vms is the "Info" part of rulesInfo
        rule.vms = opts.dc.vmsFromRule(rule);
        rulesInfo.push(rule);
    });

    try {
        locality = lib_affinity.localityFromRulesInfo(
            {log: log, rules: rulesInfo});
    } catch (err) {
        if (opts.err) {
            opts.t.ok(err, util.format(
                'error determining locality for %j', opts.exprs));
            if (opts.err.message) {
                opts.t.equal(err.message, opts.err.message,
                    util.format('error message is %j', opts.err.message));
            }
        } else {
            opts.t.ifError(err, util.format(
                'no error determining locality for %j', opts.exprs));
        }
    }
    if (opts.locality) {
        if (Array.isArray(opts.locality)) {
            foundMatch = false;
            for (i = 0; i < opts.locality.length; i++) {
                expectedLocality = opts.locality[i];
                foundMatch = deepEqual(locality, expectedLocality);
                if (foundMatch) {
                    break;
                }
            }
            locSummary = opts.locality.map(
                function (loc) { return JSON.stringify(loc); });
            opts.t.assert(foundMatch, util.format('%j -> one of %s',
                opts.exprs, locSummary.join(', ')));
        } else {
            opts.t.deepEqual(locality, opts.locality,
                util.format('%j -> %j', opts.exprs, opts.locality));
        }
    }
}



// --- Tests

test('affinity-unit', function (tt) {
    // A layout of our (unnamed) test account's VMs in the DC. We'll run
    // affinity->locality tests against this setup.
    /* BEGIN JSSTYLED */
    var dc = new MockDc([
        {
            uuid: 'aaaaaaaa-9f2c-11e7-8d2a-7b05237c283d',
            hostname: 'CNa',
            vms: [
                { uuid: '02655ed2-9f2c-11e7-a596-8f1e118e27d6', alias: 'webhead0', tags: {} },
                { uuid: '48195234-9f2c-11e7-8970-3f2cc6773306', alias: 'db0', tags: {role: 'database'} }
            ]
        },
        {
            uuid: 'bbbbbbbb-9f42-11e7-a98f-375a35af4e58',
            hostname: 'CNb',
            vms: [
                { uuid: '0dab5820-9f2d-11e7-a5ae-8b56e717c599', alias: 'webhead1', tags: {} },
                { uuid: '10d1edb6-9f2d-11e7-8923-2f7c2579fada', alias: 'db1', tags: {role: 'database'} }
            ]
        },
        {
            uuid: 'cccccccc-9f2d-11e7-bfaa-03c71f6e23e9',
            hostname: 'CNc',
            vms: [
                { uuid: 'a22832e8-9f2d-11e7-99a4-a3ae10e549f5', alias: 'webhead2', tags: {} }
            ]
        },
        {
            uuid: 'dddddddd-9f2d-11e7-9c48-2b216115a37d',
            hostname: 'CNd',
            vms: [
                { uuid: '9fec2192-9f2d-11e7-b081-fbba6b455dbd', alias: 'webhead3', tags: {} }
            ]
        }
    ]);
    /* END JSSTYLED */

    tt.test('  localityFromRulesInfo', function (t) {
        assertLocalityFromRules({
            t: t,
            dc: dc,
            exprs: ['instance!=webhead3'],
            locality: {
                strict: true,
                far: ['9fec2192-9f2d-11e7-b081-fbba6b455dbd']
            }
        });

        assertLocalityFromRules({
            t: t,
            dc: dc,
            exprs: ['container==webhead3'],
            locality: {
                strict: true,
                near: ['9fec2192-9f2d-11e7-b081-fbba6b455dbd']
            }
        });

        assertLocalityFromRules({
            t: t,
            dc: dc,
            exprs: ['role!=~datab*se'],
            locality: {
                strict: false,
                far: [
                    '48195234-9f2c-11e7-8970-3f2cc6773306',
                    '10d1edb6-9f2d-11e7-8923-2f7c2579fada'
                ]
            }
        });

        assertLocalityFromRules({
            t: t,
            dc: dc,
            exprs: [
                'role==/^data/',
                'instance!=webhead*'
            ],
            err: {
                message: 'cannot satisfy affinity rule "role==/^data/", '
                    + '"!=" rules eliminate all its servers'
            }
        });

        assertLocalityFromRules({
            t: t,
            dc: dc,
            exprs: [
                'role==/^data/',
                'instance==webhead3'
            ],
            err: {
                message: 'cannot satisfy affinity rule "instance==webhead3", '
                    + 'its servers (dddddddd-9f2d-11e7-9c48-2b216115a37d) do '
                    + 'not intersect with servers from previous rules '
                    + '(aaaaaaaa-9f2c-11e7-8d2a-7b05237c283d, '
                    + 'bbbbbbbb-9f42-11e7-a98f-375a35af4e58)'
            }
        });

        assertLocalityFromRules({
            t: t,
            dc: dc,
            exprs: [
                'instance==webhead*',
                'role==database',
                'instance!=webhead3'
            ],
            // We expect the 'near' to be the first VM from either CNa or CNb
            // (randomly selected).
            locality: [
                {
                    strict: true,
                    far: ['9fec2192-9f2d-11e7-b081-fbba6b455dbd'],
                    near: ['02655ed2-9f2c-11e7-a596-8f1e118e27d6']
                },
                {
                    strict: true,
                    far: ['9fec2192-9f2d-11e7-b081-fbba6b455dbd'],
                    near: ['0dab5820-9f2d-11e7-a5ae-8b56e717c599']
                }
            ]
        });

        t.end();
    });
});
