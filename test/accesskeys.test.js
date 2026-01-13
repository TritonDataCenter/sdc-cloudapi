/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */


const test = require('tape');
const restify = require('restify');
const common = require('./common');
const waterfall = require('vasync').waterfall;

var CLIENTS;
var CLIENT;
var OTHER;
var SERVER;
var ACCESS_KEY;

const SUB_ID = common.uuid();
const SUB_LOGIN = 'a' + SUB_ID.substr(0, 7);
const SUB_EMAIL = SUB_LOGIN + '_test@domain.tld';
const SUB_USER_PWD = common.uuid();
let SUB_USER;
let SUB_USER_ACCESS_KEY;

test('setup', function (t) {
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        CLIENT = clients.user;
        OTHER = clients.other;
        SERVER = server;

        const user = {
            login: SUB_LOGIN,
            email: SUB_EMAIL,
            password: SUB_USER_PWD
        };

        CLIENT.post('/my/users', user, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 201);
            SUB_USER = body;
            t.end();
        });
    });
});


test('ListAccessKeys (empty) OK', function (t) {
    CLIENT.get('/my/accesskeys', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.equal(body.length, 0);
        t.end();
    });
});


test('CreateAccessKey OK', function (t) {
    CLIENT.post('/my/accesskeys', {}, function (err, req, res, createdKey) {
        t.ifError(err);
        t.ok(createdKey);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        t.ok(createdKey.accesskeyid, 'accesskeyid');
        t.ok(createdKey.accesskeysecret, 'accesskeysecret');
        t.ok(createdKey.created, 'access key created');
        t.equal(createdKey.status, 'Active');
        ACCESS_KEY = createdKey;

        CLIENT.get('/my/accesskeys', function (err2, req2, res2, body2) {
            t.ifError(err2);
            t.equal(res2.statusCode, 200);
            common.checkHeaders(t, res2.headers);
            t.ok(body2);
            t.ok(body2.length);
            var key_present = false;
            body2.forEach(function (k) {
                if (k.accesskeyid === createdKey.accesskeyid) {
                    key_present = true;
                }
            });
            t.ok(key_present);
            t.end();
        });
    });
});

test('Users can only manage their own keys', function (t) {
    t.notEqual(OTHER.account.dn, CLIENT.account.dn,
        'CLIENT and OTHER clients are different users');

    waterfall([

        // Create an access key for the OTHER account
        function createAccessKey(next) {
            OTHER.post('/my/accesskeys', {},
                function (err, req, res, otherKey) {
                t.ifError(err);
                t.ok(otherKey);
                t.equal(res.statusCode, 201);
                next(null, otherKey);
            });
        },

        // Ensure CLIENT account can't GET the OTHER account's key
        function getOtherKey(otherKey, next) {
            CLIENT.get('/my/accesskeys/' + otherKey.accesskeyid,
                function (err, req, res, body) {
                t.ok(err);
                t.ok(body);

                t.equal(err.restCode, 'ResourceNotFound');
                t.ok(err.message);

                t.equal(body.code, 'ResourceNotFound');
                t.ok(body.message);

                t.equal(res.statusCode, 404);

                next(null, otherKey);
            });
        },

        // Ensure CLIENT account can't update the OTHER account's key
        function updateOtherKey(otherKey, next) {
            const url = '/my/accesskeys/' + otherKey.accesskeyid;
            const params = {
                status: 'Inactive'
            };
            CLIENT.post(url, params, function (err, req, res, body) {
                t.ok(err);
                t.ok(body);

                t.equal(err.restCode, 'InvalidArgument');
                t.ok(err.message);

                t.equal(body.code, 'InvalidArgument');
                t.ok(body.message);

                t.equal(res.statusCode, 409);

                next(null, otherKey);
            });
        },

        // Ensure CLIENT account can't delete the OTHER account's key
        function deleteOtherKey(otherKey, next) {
            CLIENT.del('/my/accesskeys/' + otherKey.accesskeyid,
                function (err, req, res, body) {
                t.ok(err);
                t.ok(body);

                t.equal(err.restCode, 'ResourceNotFound');
                t.ok(err.message);

                t.equal(body.code, 'ResourceNotFound');
                t.ok(body.message);

                t.equal(res.statusCode, 404);

                next(null, otherKey);
            });
        },

        // Ensure CLIENT account can't list the OTHER account key
        function listOtherKey(otherKey, next) {
            CLIENT.get('/my/accesskeys', function (err, req, res, keys) {
                t.ifError(err);
                t.ok(Array.isArray(keys), 'got keys');

                // Sanity check, did we find CLIENT's own key?
                const foundClientKey = keys.find(function (key) {
                    return (key.accesskeyid === ACCESS_KEY.accesskeyid);
                });
                t.ok(foundClientKey, 'found client key');

                const foundOtherKey = keys.find(function (key) {
                    return (key.accesskeyid === otherKey.accesskeyid);
                });
                t.notOk(foundOtherKey, 'other key absent');

                next(null, otherKey);
            });
        },

        // Ensure OTHER user can't GET the CLIENT key
        function getClientKey(otherKey, next) {
            OTHER.get('/my/accesskeys/' + ACCESS_KEY.accesskeyid,
                function (err, req, res, body) {
                t.ok(err);
                t.ok(body);

                t.equal(err.restCode, 'ResourceNotFound');
                t.ok(err.message);

                t.equal(body.code, 'ResourceNotFound');
                t.ok(body.message);

                t.equal(res.statusCode, 404);

                next(null, otherKey);
            });
        },

        // Ensure OTHER account can't list the CLIENT account key
        function listClientKey(otherKey, next) {
            OTHER.get('/my/accesskeys', function (err, req, res, keys) {
                t.ifError(err);
                t.ok(Array.isArray(keys), 'got keys');

                // Sanity check, did we find OTHER's own key?
                const foundClientKey = keys.find(function (key) {
                    return (key.accesskeyid === otherKey.accesskeyid);
                });
                t.ok(foundClientKey, 'found other key');

                const foundOtherKey = keys.find(function (key) {
                    return (key.accesskeyid === ACCESS_KEY.accesskeyid);
                });
                t.notOk(foundOtherKey, 'client key absent');

                next(null, otherKey);
            });
        },

        // Cleanup OTHER key
        function deleteOtherKey(otherKey, next) {
            OTHER.del('/my/accesskeys/' + otherKey.accesskeyid,
                function (err, req, res) {
                t.ifError(err);
                t.equal(res.statusCode, 204);
                common.checkHeaders(t, res.headers);
                next();
            });
        }
    ], t.end);
});

test('UpdateAccessKey OK', function (t) {
    const url = '/my/accesskeys/' + ACCESS_KEY.accesskeyid;
    const description = 'Key description updated.';
    const status = 'Inactive';
    const params = {
        status: status,
        description: description
    };
    CLIENT.post(url, params, function (err2, req2, res2, updated) {
        t.ifError(err2);
        t.equal(res2.statusCode, 201);
        t.equal(updated.status, status);
        t.equal(updated.description, description);
        t.end();
    });
});

test('CreateAccessKey with description and status', function (t) {
    const description = 'Key created with a description.';
    const status = 'Expired';
    const params = {
        status: status,
        description: description
    };

    CLIENT.post('/my/accesskeys', params, function (err, req, res, key) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        t.equal(key.description, description);
        t.equal(key.status, status);

        const url = '/my/accesskeys/' + key.accesskeyid;
        CLIENT.del(url, function (err2, _, res2) {
            t.ifError(err2);
            t.equal(res2.statusCode, 204);
            common.checkHeaders(t, res2.headers);
            t.end();
        });
    });
});

test('CreateAccessKey with non permanent credentialtype', function (t) {
    const params = { credentialtype: 'temporary' };

    CLIENT.post('/my/accesskeys', params, function (err, req, res) {
        t.ok(err);
        t.equal(res.statusCode, 403);
        t.equal(err.restCode, 'ForbiddenError');
        t.end();
    });
});

test('CreateAccessKey with invalid status', function (t) {
    const params = { status: 'Bogus' };

    CLIENT.post('/my/accesskeys', params, function (err, req, res) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        t.equal(err.restCode, 'InvalidArgument');
        t.end();
    });
});

test('CreateAccessKey with expiration', function (t) {
    const params = { expiration: '2032-01-01T00:00:00Z' };

    CLIENT.post('/my/accesskeys', params, function (err, req, res) {
        t.ok(err);
        t.equal(res.statusCode, 403);
        t.equal(err.restCode, 'ForbiddenError');
        t.end();
    });
});

test('UpdateAccessKey with non permanent credentialtype', function (t) {
    const url = '/my/accesskeys/' + ACCESS_KEY.accesskeyid;
    const params = { credentialtype: 'temporary' };

    CLIENT.post(url, params, function (err, req, res) {
        t.ok(err);
        t.equal(res.statusCode, 403);
        t.equal(err.restCode, 'ForbiddenError');
        t.end();
    });
});

test('UpdateAccessKey with expiration', function (t) {
    const url = '/my/accesskeys/' + ACCESS_KEY.accesskeyid;
    const params = { expiration: '2032-01-01T00:00:00Z' };

    CLIENT.post(url, params, function (err, req, res) {
        t.ok(err);
        t.equal(res.statusCode, 403);
        t.equal(err.restCode, 'ForbiddenError');
        t.end();
    });
});

test('GetKey OK - other', function (t) {
    var url = '/my/accesskeys/' + ACCESS_KEY.accesskeyid;

    OTHER.get(url, function (err, req, res, body) {
        t.ok(err);
        t.ok(body);

        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);

        t.equal(body.code, 'ResourceNotFound');
        t.ok(body.message);

        t.equal(res.statusCode, 404);

        t.end();
    });
});


test('DeleteAccessKey OK', function (t) {
    var url = '/my/accesskeys/' + ACCESS_KEY.accesskeyid;

    CLIENT.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('DeleteAccessKey 404', function (t) {
    CLIENT.del('/my/accesskeys/' + common.uuid(), function (err) {
        t.ok(err);
        t.equal(err.statusCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);
        t.end();
    });
});

test('CreateUserAccessKey OK', function (t) {
    var url = '/my/users/' + SUB_USER.id + '/accesskeys';

    CLIENT.post(url, {}, function (err, req, res, key) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        t.ok(key.accesskeyid);
        t.ok(key.accesskeysecret);
        SUB_USER_ACCESS_KEY = key;
        t.end();
    });
});

test('UpdateUserAccessKey OK', function (t) {
    var url = '/my/users/' + SUB_USER.id + '/accesskeys/' +
        SUB_USER_ACCESS_KEY.accesskeyid;
    var description = 'User key description updated.';
    var status = 'Inactive';
    var params = {
        status: status,
        description: description
    };
    CLIENT.post(url, params, function (err, req, res, updated) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        t.equal(updated.status, status);
        t.equal(updated.description, description);
        t.end();
    });
});

test('ListUserAccessKeys OK', function (t) {
    var url = '/my/users/' + SUB_USER.id + '/accesskeys';

    CLIENT.get(url, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        var foundKey = body.find(function (key) {
            return (key.accesskeyid === SUB_USER_ACCESS_KEY.accesskeyid);
        });
        t.ok(foundKey);
        t.end();
    });
});

test('DeleteUserAccessKey OK', function (t) {
    var url = '/my/users/' + SUB_USER.id + '/accesskeys/' +
        SUB_USER_ACCESS_KEY.accesskeyid;

    CLIENT.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        t.end();
    });
});

test('Delete subuser', function (t) {
    CLIENT.del('/my/users/' + SUB_USER.id, function (err) {
        t.ifError(err);
        t.end();
    });
});

test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
