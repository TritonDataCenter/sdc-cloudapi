/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2026 Edgecast Cloud LLC.
 */

var test = require('tape');

var validRecordSize = require('../lib/validation/disk').validRecordSize;

// --- Tests

test('validRecordSize accepts the supported range', function (t) {
    [512, 1024, 4096, 8192, 16384, 65536, 131072].forEach(function chk(size) {
        t.ok(validRecordSize(size), size + ' is valid');
    });

    t.end();
});


test('validRecordSize accepts integer strings', function (t) {
    t.ok(validRecordSize('8192'), '"8192" is valid');
    t.notOk(validRecordSize('8193'), '"8193" is not a power of 2');
    t.end();
});


test('validRecordSize rejects out-of-range and non-power-of-2', function (t) {
    [0, 511, 1000, 8193, 131073, 262144, -8192].forEach(function chk(size) {
        t.notOk(validRecordSize(size), size + ' is invalid');
    });

    t.end();
});


/*
 * Without a type check the range comparisons coerce these to NaN, which is
 * false against every bound, and (NaN & NaN) is 0, so each one used to be
 * reported as a valid record size.
 */
test('validRecordSize rejects non-integers', function (t) {
    var cases = [
        ['4096.5', 4096.5],
        ['"garbage"', 'garbage'],
        ['{}', {}],
        ['[]', []],
        ['[8192]', [8192]],
        ['null', null],
        ['undefined', undefined],
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['true', true],
        ['false', false],
        ['empty string', '']
    ];

    cases.forEach(function chk(c) {
        t.notOk(validRecordSize(c[1]), c[0] + ' is invalid');
    });

    t.end();
});
