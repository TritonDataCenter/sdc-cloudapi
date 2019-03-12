/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

/*
 * Affinity rule *unit* tests.
 * See machines/affinity.test.js for integration tests.
 */

var assert = require('assert-plus');
var test = require('@smaller/tap').test;

var affinity_lib = require('../lib/triton-affinity');


// --- Helpers

function checkOk(t, strArr, expected) {
    affinity_lib.parseAffinity({ affinity: strArr }, function (err, affinity) {
        t.ifError(err, 'err');
        t.deepEqual(affinity, expected, 'check results');
    });
}

function checkErr(t, strArr, errRegex) {
    affinity_lib.parseAffinity({ affinity: strArr }, function (err) {
        t.ok(err, 'err');
        t.ok(errRegex.test(err.message), 'check err msg');
    });
}


// --- Tests

test('affinity-unit', function (t) {
    checkOk(t, [], undefined);

    checkOk(t, ['instance!=webhead3'], [ {
        key: 'instance',
        operator: '!=',
        value: 'webhead3',
        isSoft: false,
        valueType: 'exact'
    } ]);

    checkOk(t, ['container==webhead3'], [ {
        key: 'container',
        operator: '==',
        value: 'webhead3',
        isSoft: false,
        valueType: 'exact'
    } ]);

    checkOk(t, ['role!=~datab*se'], [ {
        key: 'role',
        operator: '!=',
        value: 'datab*se',
        isSoft: true,
        valueType: 'glob'
    } ]);

    checkOk(t, [
        'role==/^data/',
        'instance!=webhead*'
    ], [ {
        key: 'role',
        operator: '==',
        value: '/^data/',
        isSoft: false,
        valueType: 're'
    }, {
        key: 'instance',
        operator: '!=',
        value: 'webhead*',
        isSoft: false,
        valueType: 'glob'
    } ]);

    checkOk(t, [
        'role==/^data/',
        'instance==webhead3'
    ], [ {
        key: 'role',
        operator: '==',
        value: '/^data/',
        isSoft: false,
        valueType: 're'
    }, {
        key: 'instance',
        operator: '==',
        value: 'webhead3',
        isSoft: false,
        valueType: 'exact'
    } ]);

    checkOk(t, [
        'instance==webhead*',
        'role==database',
        'instance!=webhead3'
    ], [ {
        key: 'instance',
        operator: '==',
        value: 'webhead*',
        isSoft: false,
        valueType: 'glob'
    }, {
        key: 'role',
        operator: '==',
        value: 'database',
        isSoft: false,
        valueType: 'exact'
    }, {
        key: 'instance',
        operator: '!=',
        value: 'webhead3',
        isSoft: false,
        valueType: 'exact'
    } ]);

    checkErr(t, ['instance=webhead3'], /could not find operator/);

    checkErr(t, ['instance===webhead3'], /invalid value/);

    checkErr(t, [
        'instance==webhead3',
        'instance=webhead3'
    ], /could not find operator/);

    t.end();
});
