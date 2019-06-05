/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

var fs = require('fs');

var test = require('@smaller/tap').test;

var getCreateOptions = require('../lib/machines')._getCreateOptions;
var safeBrandName = require('../lib/machines')._safeBrandName;

// --- Globals

var VERSION =
    JSON.parse(fs.readFileSync(__dirname + '/../package.json', 'utf8')).version;

var IMAGES = {
    'smartos-1.6.3': {
        name: 'sdc-smartos',
        os: 'smartos',
        type: 'zone-dataset',
        uuid: 'fd2cc906-8938-11e3-beab-4359c665ac99',
        version: '1.6.3'
    },
    'ubuntu-bhyve-17.10': {
        uuid: '38396fc7-2472-416b-e61b-d833b32bd088',
        name: 'ubuntu-bhyve-17.10',
        version: '20180207',
        type: 'zvol',
        os: 'linux',
        requirements: {
            brand: 'bhyve'
        }
    },
    'ubuntu-bhyve-17.10-noBrandReq': {
        uuid: '38396fc7-2472-416b-e61b-d833b32bd088',
        name: 'ubuntu-bhyve-17.10',
        version: '20180207',
        type: 'zvol',
        os: 'linux'
    },
    'ubuntu-certified-16.04': {
        name: 'ubuntu-certified-16.04',
        os: 'linux',
        type: 'zvol',
        uuid: 'd42c37f4-2956-413f-b12a-32a79dfe84af',
        version: '20180109'
    }
};

// --- Helpers

//
// The following optional parameters are also used in getCreateOptions but not
// required, so not added if unset:
//
// img.brand
// img.disk_driver
// img.nic_driver
// img.requirements.brand
// img.type=='zvol'
//
// pkg.brand
// pkg.fss
// pkg.os
// pkg.* (any arbitrary parameter)
//
// params.administrator_pw
// params.affinity
// params.deletion_protection
// params.firewall_enabled
// params.locality
// params.metadata.credentials
// params.metadata.*
// params.password
// params.server_uuid
// params.tag.*
//
// root_authorized_keys
//
// config.test [boolean]
//

function buildReq(options) {
    var req = {};
    var version = VERSION;

    if (options.pkg === undefined) {
        req.pkg = {};
    } else {
        req.pkg = options.pkg;
    }

    if (options.img === undefined) {
        req.img = {};
    } else {
        req.img = options.img;
    }

    if (options.root_authorized_keys !== undefined) {
        req.root_authorized_keys = options.root_authorized_keys;
    }

    // pkg.uuid is required
    if (req.pkg.uuid === undefined) {
        req.pkg.uuid = 'b38c6e18-1fe4-11e8-82ac-6bf052d2fa79';
    }

    // pkg.max_physical_memory is required
    if (req.pkg.max_physical_memory === undefined) {
        req.pkg.max_physical_memory = 256;
    }

    // pkg.quota is required
    if (req.pkg.quota === undefined) {
        req.pkg.quota = 10 * 1024; // MiB
    }

    // img.uuid is required
    if (req.img.uuid === undefined) {
        req.img.uuid = 'e306f7a1-069b-4830-8d49-96eb21db975d';
    }

    // img.os is required
    if (req.img.os === undefined) {
        req.img.os = 'linux';
    }

    // img.name is required
    if (req.img.name === undefined) {
        req.img.name = 'ubuntu-16.04';
    }

    // config is required
    if (options.config === undefined) {
        req.config = {};
    } else {
        req.config = options.config;
    }

    // need req.params
    if (options.params === undefined) {
        req.params = {};
    } else {
        req.params = options.params;
    }

    // params.networks is required
    if (req.params.networks === undefined) {
        req.params.networks = [
            '2b6683a9-50bb-4d79-a0e6-f2576a93f2fb'
        ];
    }

    // req.networks is "all networks"
    if (options.allNetworks === undefined) {
        req.networks = [
            '2b6683a9-50bb-4d79-a0e6-f2576a93f2fb'
        ];
    } else {
        req.networks = options.allNetworks;
    }

    // req.external_nets is "external networks"
    if (options.externalNetworks === undefined) {
        req.external_nets = [];
    } else {
        req.external_nets = options.externalNetworks;
    }

    if (options.version !== undefined) {
        version = options.version;
    }

    req.getVersion = function _getVersion() {
        return (version);
    };

    // rename img -> dataset
    req.dataset = req.img;
    delete req.img;

    return (req);
}





// --- Tests

test('getCreateOptions sets brand to "joyent" by default', function (t) {
    var createOpts;
    var req;

    req = buildReq({
        img: IMAGES['smartos-1.6.3']
    });

    createOpts = getCreateOptions(req);

    t.equal(createOpts.brand, 'joyent', 'default brand should be joyent');
    t.end();
});


test('getCreateOptions sets brand to "kvm" by when img.type === zvol',
    function (t) {

    var createOpts;
    var req;

    req = buildReq({
        img: IMAGES['ubuntu-certified-16.04']
    });

    createOpts = getCreateOptions(req);

    t.equal(createOpts.brand, 'kvm', 'default brand should be kvm for zvol');
    t.end();
});


test('getCreateOptions sets brand to "bhyve" by when img.requirements.brand ' +
    '=== bhyve', function (t) {

    var createOpts;
    var req;

    req = buildReq({
        img: IMAGES['ubuntu-bhyve-17.10']
    });

    createOpts = getCreateOptions(req);

    t.equal(createOpts.brand, 'bhyve',
        'brand should be bhyve when image requires');
    t.end();
});


test('getCreateOptions sets brand to "bhyve" by when pkg.brand === bhyve',
    function (t) {

    var createOpts;
    var req;

    req = buildReq({
        img: IMAGES['ubuntu-bhyve-17.10-noBrandReq'],
        pkg: {
            brand: 'bhyve'
        }
    });

    createOpts = getCreateOptions(req);

    t.equal(createOpts.brand, 'bhyve',
        'brand should be bhyve when package specifies');
    t.end();
});


test('getCreateOptions blows up when pkg.brand is unknown',
    function (t) {

    var createOpts;
    var req;

    req = buildReq({
        img: IMAGES['ubuntu-bhyve-17.10-noBrandReq'],
        pkg: {
            brand: 'sphygmomanometer'
        }
    });

    t.throws(function _getPayload() {
        createOpts = getCreateOptions(req);
        t.equal(createOpts, undefined, 'should not have createOpts');
    }, /Package requires unknown brand/,
        'invalid pkg.brand should result in exception');

    t.end();
});


test('getCreateOptions blows up when pkg.brand and img.requirements.brand ' +
    'conflict', function (t) {

    var createOpts;
    var req;

    req = buildReq({
        img: IMAGES['ubuntu-bhyve-17.10'], // requires bhyve brand
        pkg: {
            brand: 'kvm'
        }
    });

    t.throws(function _getPayload() {
        createOpts = getCreateOptions(req);
        t.equal(createOpts, undefined, 'should not have createOpts');
    // JSSTYLED
    }, /Package requires brand "kvm", but brand "bhyve" was selected/,
        'conflicting pkg.brand and img.requirements.brand should result in ' +
        'exception');

    t.end();
});

test('getCreateOptions blows up when pkg.brand and img.type conflict',
    function (t) {
    var createOpts;
    var req, req2;

    req = buildReq({
        img: IMAGES['ubuntu-bhyve-17.10-noBrandReq'],
        pkg: {
            brand: 'lx'
        }
    });

    t.throws(function _getPayload() {
        createOpts = getCreateOptions(req);
        t.equal(createOpts, undefined, 'should not have createOpts');
    // JSSTYLED
    }, /Package requires brand "lx" and image.type is incompatible \("zvol"\)/,
        'conflicting pkg.brand and img.type should result in exception');


    req2 = buildReq({
        img: IMAGES['smartos-1.6.3'],
        pkg: {
            brand: 'bhyve'
        }
    });

    t.throws(function _getPayload2() {
        createOpts = getCreateOptions(req2);
        t.equal(createOpts, undefined, 'should not have createOpts');
    // JSSTYLED
    }, /Package requires brand "bhyve" and image.type is not "zvol"/,
        'conflicting pkg.brand and img.type should result in exception');

    t.end();
});


test('test safeBrandName', function test_safe_brand_name(t) {
    // undefined should blow the assert.string
    t.throws(function _garbageInUndefined() {
        safeBrandName(undefined);
    }, /brandName \(string\) is required/,
        'undefined should blow safeBrandName assert.string');

    // any object should blow the assert.string
    t.throws(function _garbageInObject() {
        safeBrandName({'S-Mart': 'BOOMSTICK'});
    }, /brandName \(string\) is required/,
        'object should blow safeBrandName assert.string');

    t.equal(safeBrandName('joyent-minimal'), 'joyent-minimal',
        'joyent-minimal should be untouched');
    t.equal(safeBrandName('hash#tag'), 'hashtag',
        'should remove "#" character');
    t.equal(safeBrandName(
        // input
        'abcdefghijklmnopqrstuvwxyz' +
        'abcdefghijklmnopqrstuvwxyz' +
        'abcdefghijklmnopqrstuvwxyz'),
        // output
        'abcdefghijklmnopqrstuvwxyz' +
        'abcdefghijklmnopqrstuvwxyz' +
        'abcdefghijkl',
        'long name should be truncated to 64 characters');

    t.end();
});
