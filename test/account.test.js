/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var test = require('tape').test;
var util = require('util');
var common = require('./common');

var checkNotAuthorized = common.checkNotAuthorized;


// --- Globals


var USER_DETAILS = {
    givenName: 'James',
    sn: 'Bond',
    cn: 'James Bond',
    company: 'liltingly, Inc.',
    address: '6165 pyrophyllite Street',
    city: 'benzoylation concoctive',
    state: 'SP',
    postalCode: '4967',
    country: 'BAT',
    phone: '+1 891 657 5818'
};

var CLIENTS;
var CLIENT;
var OTHER;
var SERVER;


// --- Helpers


function checkOk(t, err, req, res, body) {
    t.ifError(err);
    t.ok(req);
    t.ok(res);
    common.checkHeaders(t, res.headers);
    t.ok(body);
    t.equal(body.login, CLIENT.login);
    t.equal(body.email, CLIENT.login);
    t.ok(body.id);
    t.ok(body.created);
    t.ok(body.updated);
    t.equal(res.statusCode, 200);
}


// --- Tests


test('setup', function (t) {
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        OTHER   = clients.other;
        SERVER  = server;

        t.end();
    });
});


test('GetAccount(my) OK', function (t) {
    CLIENT.get('/my', function (err, req, res, obj) {
        checkOk(t, err, req, res, obj);
        t.end();
    });
});


test('GetAccount(:login) OK', function (t) {
    var path = '/' + encodeURIComponent(CLIENT.login);
    CLIENT.get(path, function (err, req, res, obj) {
        checkOk(t, err, req, res, obj);
        t.end();
    });
});


test('GetAccount(:login) other', function (t) {
    var path = '/' + encodeURIComponent(CLIENT.login);
    OTHER.get(path, function (err, req, res, obj) {
        checkNotAuthorized(t, err, req, res, obj);
        t.end();
    });
});

test('GetAccount 403', function (t) {
    CLIENT.get('/admin', function (err, req, res, obj) {
        checkNotAuthorized(t, err, req, res, obj);
        t.end();
    });
});


test('GetAccount 404', function (t) {
    CLIENT.get('/' + common.uuid(), function (err) {
        t.ok(err);
        t.equal(err.statusCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.end();
    });
});


test('PostAccount OK', function (t) {
    var path = '/' + encodeURIComponent(CLIENT.login);

    CLIENT.post(path, USER_DETAILS, function (err, req, res, obj) {
        t.ifError(err);
        checkOk(t, err, req, res, obj);
        t.ok(obj.companyName);
        t.ok(obj.firstName);
        t.ok(obj.lastName);
        t.ok(obj.postalCode);
        t.ok(obj.city);
        t.ok(obj.state);
        t.ok(obj.country);
        t.ok(obj.phone);
        t.end();
    });
});


test('PostAccount other', function (t) {
    var path = '/' + encodeURIComponent(CLIENT.login);

    OTHER.post(path, USER_DETAILS, function (err, req, res, obj) {
        checkNotAuthorized(t, err, req, res, obj);
        t.end();
    });
});


// a test of a role-tag corner-case
test('PutAccount OK', function (t) {
    var path = '/' + encodeURIComponent(CLIENT.login);

    CLIENT.put(path, USER_DETAILS, function (err, req, res, obj) {
        t.ifError(err);

        t.equal(typeof (obj.name), 'string');
        t.deepEqual(obj['role-tag'], []);

        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
