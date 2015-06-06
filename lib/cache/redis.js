/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Redis cache.
 */

var assert = require('assert-plus');
var redis = require('redis');
var sprintf = require('util').format;

var TOKEN_KEY = 'cloudapi:tokenToUsername:%s';
var CLIENT_KEY = 'cloudapi:tokenToClient:%s';


/*
 * Redis cache client constructor
 */
function Redis(options) {
    assert.object(options, 'redis options');
    assert.object(options.log, 'redis options.log');

    this.options = options;
    this.log = options.log;
}



/*
 * Calls redis.createClient and assigns it to this.client. Will call the
 * callback parameter when the client is connected and ready to use
 */
Redis.prototype.connect = function () {
    return attemptConnect.call(this);
};



/*
 * attemptConnect will call itself via timers until a connection to redis has
 * been established
 */
function attemptConnect() {
    var self = this;
    var log = this.log;
    var timeout = null;

    var client = this.client = redis.createClient(
        this.options.port || 6379,   // redis default port
        this.options.host || '127.0.0.1',
        { max_attempts: 1 });

    function onReady() {
        clearTimeout(timeout);
        timeout = null;

        // CloudAPI's (unofficial) DB Index
        client.select(10);
        log.debug('Redis client connected');
    }

    function onError(err) {
        log.error(err, 'Redis client error');
    }

    function onEnd() {
        client.end();
        self.client = null;
        log.error('Redis client disconnected');
        log.info('Re-attempting connection to Redis');

        if (!timeout) {
            attemptConnect.call(self);
        }
    }

    function timeoutCallback() {
        attemptConnect.call(self);
    }

    client.once('ready', onReady);
    client.on('error', onError);
    client.once('end', onEnd);

    timeout = setTimeout(timeoutCallback, 10000);
}



/*
 * Returns client.connected
 */
Redis.prototype.connected = function () {
    return this.client && this.client.connected;
};


/*
 * Low level redis GET command
 */
Redis.prototype.get = function (key, callback) {
    return this.client.get(key, callback);
};


/*
 * Low level redis SETEX command
 */
Redis.prototype.set = function (key, ttl, value, callback) {
    return this.client.setex(key, ttl, value, callback);
};


/*
 * Low level redis EXISTS command
 */
Redis.prototype.exists = function (key, callback) {
    this.client.exists(key, callback);
};



/**
 * Cache helper functions
 */


Redis.prototype.storeToken = function (token, ttl, username, callback) {
    var self = this;
    var key = sprintf(TOKEN_KEY, token);
    
    return self.set(key, ttl, username, callback);
};

Redis.prototype.storeClient = function (token, ttl, client, callback) {
    var self = this;
    var key = sprintf(CLIENT_KEY, token);
    
    return self.set(key, ttl, client, callback);
};


Redis.prototype.getUsername = function (token, callback) {
    var self = this;
    var key = sprintf(TOKEN_KEY, token);
    
    return self.get(key, callback);
};

Redis.prototype.getClient = function (token, callback) {
    var self = this;
    var key = sprintf(CLIENT_KEY, token);
    
    return self.get(key, callback);
};

Redis.prototype.tokenExists = function (token, callback) {
    var self = this;
    var key = sprintf(TOKEN_KEY, token);
    
    return self.exists(key, callback);
};


module.exports = Redis;