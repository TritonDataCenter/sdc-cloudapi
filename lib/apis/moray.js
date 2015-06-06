/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * A brief overview of this source file: what is its purpose.
 */


var EventEmitter = require('events').EventEmitter;
var sprintf = require('sprintf').sprintf;
var assert = require('assert');
var restify = require('restify');
var util = require('util');
var Logger = require('bunyan');
var async = require('async');

var moray = require('moray');

var PARAM_FILTER = '(%s=%s)';


// Only indexed columns can be searched
var SEARCHABLE_FIELDS = [
    'owner_uuid',
    'client_id',
    'client_secret',
    'revoked'
];

/*
 * Basically the OAuth table
 */
var OAUTH_BUCKET_NAME = 'oauth_clients';
var OAUTH_BUCKET = {
    index: {
        owner_uuid: { type: 'string' },
        client_id: { type: 'string', unique: true },
        client_secret: { type: 'string' },
        revoked: { type: 'boolean' }
    }
};


/*
 * Moray constructor
 */
function Moray(options) {
    EventEmitter.call(this);
    // this.log = options.log;
    // this.log.level(options.logLevel || 'info');
    this.log = new Logger({
        name: 'moray',
        level: options.logLevel || 'info',
        serializers: restify.bunyan.serializers
    });
    this.options = options;
}

util.inherits(Moray, EventEmitter);



/*
 * Attempts to connect to moray, retrying until connection is established. After
 * connection is established buckets get initialized
 */
Moray.prototype.connect = function () {
    var self = this;
    var log = this.log;
    var retry = this.options.retry || {};
    this.log.debug('Connecting to moray...');

    var connection = this.connection = moray.createClient({
        connectTimeout: this.options.connectTimeout || 200,
        log: this.log,
        host: this.options.host,
        port: this.options.port,
        reconnect: true,
        retry: (this.options.retry === false ? false : {
            retries: Infinity,
            minTimeout: retry.minTimeout || 1000,
            maxTimeout: retry.maxTimeout || 16000
        })
    });

    connection.on('connect', function () {
        log.info({ moray: connection.toString() }, 'moray: connected');
        self.emit('moray-connected');

        connection.on('error', function (err) {
            // not much more to do because the moray client should take
            // care of reconnecting, etc.
            log.error(err, 'moray client error');
        });

        self._setupBuckets(function (err) {
            if (err) {
                self.log.error({ err: err }, 'Buckets were not loaded');
            } else {
                self.emit('moray-ready');
                self.log.info('Buckets have been loaded');
            }
        });
    });
};



/*
 * Pings Moray by calling its ping method
 */
Moray.prototype.ping = function (callback) {
    // Default ping timeout is 1 second
    return this.connection.ping({ log: this.log }, callback);
};



Moray.prototype.getClientById = function (id, cb) {
    var filter = '';
    
    filter += sprintf(PARAM_FILTER, 'client_id', id);
    
    var client;
    var req = this.connection.findObjects(OAUTH_BUCKET_NAME, filter);

    req.once('error', function (err) {
        return cb(err);
    });

    // For getClientById we want the first result (and there should only be one result)
    req.once('record', function (object) {
        client = object.value;
    });

    return req.once('end', function () {
        return cb(null, client);
    });
};



/*
 * Sets up the OAuth buckets.
 */
Moray.prototype._setupBuckets = function (cb) {
    var self = this;
    var buckets = [ {
        name: OAUTH_BUCKET_NAME,
        indices: OAUTH_BUCKET
    } ];
    
    
    // For the sake of testing
    self.connection.putObject(OAUTH_BUCKET_NAME, '3a9769a9-9bb3-4697-9b28-8ae8c05f08e6', {
	    owner_id: '930896af-bf8c-48d4-885c-6573a94b1853',
	    client_id: 'officialApiClient',
	    client_secret: 'C0FFEE',
	    revoked: false
    }, function(){});
    
    async.mapSeries(buckets, function (bucket, next) {
        self._getBucket(bucket.name, function (err, bck) {
            if (err) {
                if (err.name === 'BucketNotFoundError') {
                    self._createBucket(bucket.name, bucket.indices, next);
                } else {
                    next(err);
                }
            } else {
                next(null);
            }
        });
    }, function (err) {
        cb(err);
    });
};



/*
 * Gets a bucket
 */
Moray.prototype._getBucket = function (name, cb) {
    this.connection.getBucket(name, cb);
};



/*
 * Creates a bucket
 */
Moray.prototype._createBucket = function (name, config, cb) {
    this.connection.createBucket(name, config, cb);
};



/*
 * Deletes a bucket
 */
Moray.prototype._deleteBucket = function (name, cb) {
    this.connection.delBucket(name, cb);
};



module.exports = Moray;
