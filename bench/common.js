/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * CloudAPI Benchmark Suite.
 *
 * Shared stuff between main file and child processes
 */
var smartdc = require('smartdc'),
    CloudAPI = smartdc.CloudAPI;
var util = require('util');
var assert = require('assert');

// I know this is ugly, but the extra verbosity and no cache is needed:
CloudAPI.prototype._get = function (req, callback) {
    assert.ok(req);
    assert.ok(callback);

    var self = this;

    // Issue HTTP request
    return this.client.get(req, function (err, request, res, obj) {
        if (err) {
            err = self._error(err);
        }
        return callback(err, obj, res);
    });
};

CloudAPI.prototype._post = function (req, callback) {
    assert.ok(req);
    assert.ok(callback);

    var self = this,
        body = req.body || {};
    delete req.body;

    // Issue HTTP request
    return this.client.post(req, body, function (err, request, res, obj) {
        if (err) {
            err = self._error(err);
        }
        return callback(err, obj, res);
    });
};


CloudAPI.prototype._put = function (req, callback) {
    assert.ok(req);
    assert.ok(callback);

    var self = this,
        body = req.body || {};
    delete req.body;

    // Issue HTTP request
    return this.client.put(req, body, function (err, request, res, obj) {
        if (err) {
            err = self._error(err);
        }
        return callback(err, obj, res);
    });
};


CloudAPI.prototype._del = function (req, callback) {
    assert.ok(req);
    assert.ok(callback);

    var self = this;

    // Issue HTTP request
    return this.client.del(req, function (err, request, res, _obj) {
        if (err) {
            err = self._error(err);
        }
        return callback(err, res);
    });
};

// It's hard to do any benchmarking with original listMachines:
CloudAPI.prototype.listMachines = function (account, options, tags, callback) {
    if (typeof (account) === 'function') {
        callback = account;
        tags = {};
        options = {};
        account = this.account;
    }
    if (typeof (options) === 'function') {
        callback = options;
        tags = {};
        options = account;
        account = this.account;
    }
    if (typeof (tags) === 'function') {
        callback = tags;
        if (typeof (account) === 'object') {
            tags = options;
            options = account;
            account = this.account;
        } else {
            tags = {};
            options = account;
            account = this.account;
        }
    }
    if (typeof (options) !== 'object') {
        throw new TypeError('options must be an object');
    }
    if (!callback || typeof (callback) !== 'function') {
        throw new TypeError('callback (function) required');
    }
    if (typeof (account) === 'object') {
        account = account.login;
    }

    if (tags === '*') {
        options.tags = '*';
    } else {
        var k;
        for (k in tags) {
            if (tags.hasOwnProperty(k)) {
                options['tag.' + k] = tags[k];
            }
        }
    }

    var self = this;
    return this._request(util.format('/%s/machines', account), null,
            function (req) {
        req.query = options;
        return self.client.get(req, function (err, request, res, obj) {
            if (err) {
                return callback(self._error(err));
            }

            return callback(err, obj, res);
        });
    });
};

/*
 * Creates a CloudAPI client for the given user
 */
function createSDCClient(user, key, fp) {
    return (new CloudAPI({
        connectTimeout: 1000,
        logLevel: (process.env.LOG_LEVEL || 'info'),
        retry: false,
        sign: smartdc.privateKeySigner({
            key: key,
            keyId: fp,
            user: user
        }),
        url: process.env.CLOUDAPI_URL || 'https://10.99.99.38',
        account: user,
        noCache: true,
        rejectUnauthorized: false
    }));
}

module.exports = {
    createSDCClient: createSDCClient
};
