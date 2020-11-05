/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var test = require('@smaller/tap').test;
var plugin = require('../../plugins/free_tier');
var restify = require('restify');


// --- Globals


var API = {
    getActiveVmsForAccount: function () {},
    NotAuthorizedError: restify.NotAuthorizedError,
    log: {
        info: function () {},
        debug: function () {},
        error: function () {}
    }
};

var PACKAGES = [ {
    uuid: 'c09a10c8-f96b-11e7-a1d2-4396f3b1d925'
}, {
    uuid: 'c74857d6-f96b-11e7-be2e-93f2929bb742'
} ];

var PREPROVISION;


// --- Tests


test('setup allowProvision without api',
function (t) {
    try {
        plugin.allowProvision();
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'api (object) is required', 'err message');
    }

    t.end();
});


test('setup allowProvision without cfg',
function (t) {
    try {
        plugin.allowProvision(API);
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'cfg (object) is required', 'err message');
    }

    t.end();
});


test('setup allowProvision with invalid cfg',
function (t) {
    try {
        plugin.allowProvision(API, {
            packages: ''
        });
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'cfg.packages ([uuid]) is required', 'err message');
    }

    t.end();
});


test('setup',
function (t) {
    PREPROVISION = plugin.allowProvision(API, {
        packages: PACKAGES.map(function (pkg) { return pkg.uuid; })
    });

    t.end();
});


test('allowProvision with non-free package',
function (t) {
    API.getActiveVmsForAccount = function () {
        t.fail('should not be called');
    };

    PREPROVISION({
        account: {},
        pkg: { uuid: '6a204da2-f970-11e7-be40-cba47f48e574' },
        req_id: '27ba32f8-f96f-11e7-a569-7f7ffc56b89b'
    }, function allowProvisionCb(err) {
        t.ifErr(err, 'err');
        t.end();
    });
});


test('allowProvision with admin user',
function (t) {
    API.getActiveVmsForAccount = function () {
        t.fail('should not be called');
    };

    var called = false;

    PREPROVISION({
        account: {
            isAdmin: function () {
                called = true;
                return true;
            }
        },
        pkg: PACKAGES[0],
        req_id: '27ba32f8-f96f-11e7-a569-7f7ffc56b89b'
    }, function allowProvisionCb(err) {
        t.ifErr(err, 'err');
        t.equal(called, true, 'isAdmin() was called');
        t.end();
    });
});


test('allowProvision with user more than a year old',
function (t) {
    API.getActiveVmsForAccount = function () {
        t.fail('should not be called');
    };

    var days366ago = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);

    PREPROVISION({
        account: {
            isAdmin: function () { return false; },
            created_at: days366ago.toISOString()
        },
        pkg: PACKAGES[0],
        req_id: '27ba32f8-f96f-11e7-a569-7f7ffc56b89b'
    }, function allowProvisionCb(err) {
        t.ok(err, 'err');
        t.equal(err.statusCode, 403, 'statusCode');
        t.equal(err.restCode, 'NotAuthorized', 'message');
        t.equal(err.message, 'QuotaExceeded; free tier offering is limited ' +
            'to a single instance for the first year after the account has ' +
            'been created', 'NotAuthorized');
        t.end();
    });
});


test('allowProvision with a matching free VMs',
function (t) {
    var called = false;

    API.getActiveVmsForAccount = function (args, cb) {
        t.equal(args.account.uuid, '4126713e-f974-11e7-b896-0724b8f2d98b',
            'account uuid');
        t.equal(args.fields, 'billing_id', 'billing_id');

        called = true;

        cb(null, [ {
            billing_id: '5ec1780a-f975-11e7-a5d3-fb5712313c38'
        }, {
            billing_id: PACKAGES[1].uuid
        } ]);
    };

    var days364ago = new Date(Date.now() - 364 * 24 * 60 * 60 * 1000);

    PREPROVISION({
        account: {
            uuid: '4126713e-f974-11e7-b896-0724b8f2d98b',
            isAdmin: function () { return false; },
            created_at: days364ago.toISOString()
        },
        pkg: PACKAGES[0],
        req_id: '27ba32f8-f96f-11e7-a569-7f7ffc56b89b'
    }, function allowProvisionCb(err) {
        t.ok(err, 'err');
        t.equal(err.statusCode, 403, 'statusCode');
        t.equal(err.restCode, 'NotAuthorized', 'message');
        t.equal(err.message, 'QuotaExceeded; free tier offering is limited ' +
            'to a single instance for the first year after the account has ' +
            'been created', 'NotAuthorized');

        t.equal(called, true, 'getActiveVmsForAccount called');

        t.end();
    });
});


test('allowProvision with no matching free VMs',
function (t) {
    API.getActiveVmsForAccount = function (_, cb) {
        cb(null, [ {
            billing_id: '5ec1780a-f975-11e7-a5d3-fb5712313c38'
        }, {
            billing_id: '39c51e5c-f976-11e7-8a57-d77f3551fb13'
        } ]);
    };

    PREPROVISION({
        account: {
            uuid: '4126713e-f974-11e7-b896-0724b8f2d98b',
            isAdmin: function () { return false; },
            created_at: new Date().toISOString()
        },
        pkg: PACKAGES[0],
        req_id: '27ba32f8-f96f-11e7-a569-7f7ffc56b89b'
    }, function allowProvisionCb(err) {
        t.ifErr(err, 'err');
        t.end();
    });
});


test('allowProvision - badargs',
function (t) {
    try {
        PREPROVISION();
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'opts (object) is required', 'err message');
    }

    try {
        PREPROVISION({});
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'opts.account (object) is required', 'err message');
    }

    try {
        PREPROVISION({
            account: {}
        });
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'opts.pkg (object) is required', 'err message');
    }

    try {
        PREPROVISION({
            account: {},
            pkg: PACKAGES[0]
        });
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'opts.req_id (uuid) is required', 'err message');
    }

    try {
        PREPROVISION({
            account: {},
            pkg: PACKAGES[0],
            req_id: '27ba32f8-f96f-11e7-a569-7f7ffc56b89b'
        });
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'cb (func) is required', 'err message');
    }

    t.end();
});
