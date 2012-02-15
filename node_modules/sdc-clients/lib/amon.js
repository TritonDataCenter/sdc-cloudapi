// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var querystring = require('querystring');
var restify = require('restify');
var sprintf = require('sprintf').sprintf;


///--- Globals

var HttpCodes = restify.HttpCodes;
var RestCodes = restify.RestCodes;
var log = restify.log;
var newError = restify.newError;


var USER_FMT = '/pub/%s';

var MONITOR_BASE_FMT = USER_FMT + '/monitors';
var MONITOR_FMT = MONITOR_BASE_FMT + '/%s';

var PROBE_BASE_FMT = MONITOR_FMT + '/probes/';
var PROBE_FMT = PROBE_BASE_FMT + '%s';


///--- Exported Amon Client

/**
 * Constructor
 *
 * Note that in options you can pass in any parameters that the restify
 * RestClient constructor takes (for example retry/backoff settings).
 *
 * @param {Object} options
 *                  - url {String} CA location.
 *
 */
function Amon(options) {
  if (!options) throw new TypeError('options required');
  if ((options.uri && options.url) ||
      !(options.uri || options.url))
    throw new TypeError('One of options.uri, options.url required');

  if (options.uri)
    options.url = options.uri;
  if (options.logLevel)
    log.level(options.logLevel);
  if (!options.version)
    options.version = '1';
  this.client = restify.createClient(options);
}


/**
 * Ping Amon server.
 *
 * @param {Function} callback : call of the form f(err, pong).
 */
Amon.prototype.ping = function(callback) {
  this._validateCallback(callback);
  var self = this;
  return this.client.get("/ping", function(err, pong, headers) {
    if (err) {
      return callback(self._translateError(err));
    }
    return callback(null, pong);
  });
};


/**
 * Lists monitors by customer
 *
 * @param {String} customer : the customer uuid.
 * @param {Function} callback : call of the form f(err, monitors).
 */
Amon.prototype.listMonitors = function(customer, callback) {
  if (!customer) {
    throw new TypeError('customer is required');
  }

  this._validateCallback(callback);

  var self = this;
  var request = {
    path: sprintf(MONITOR_BASE_FMT, customer)
  };

  return this.client.get(request, function(err, obj, headers) {
    if (err) {
      return callback(self._translateError(err));
    }

    return callback(null, obj);
  });
};


/**
 * Gets monitor by customer and monitor name.
 *
 *
 * @param {String} customer : the customer uuid.
 * @param {String} monitorName : the name of the monitor.
 * @param {Function} callback of the form f(err, monitor).
 */
Amon.prototype.getMonitor = function(customer, monitorName, callback) {
  if (!customer) {
    throw new TypeError('customer is required');
  }

  if (!monitorName) {
    throw new TypeError('monitorName is required');
  }

  this._validateCallback(callback);

  var self = this;
  var request = {
    path: sprintf(MONITOR_FMT, customer, monitorName)
  };

  return this.client.get(request, function(err, obj, header) {
    if (err) {
      return callback(self._translateError(err));
    }

    return callback(null, obj);
  });
};


/**
 * Creates a monitor for a user
 *
 * @param {String} customer : Customer uuid.
 * @param {Object}  monitor : The monitor, should contain the following
 *    `[{"contacts" : ["email"]}]`.
 * @param {Function} callback of the form f(err, account).
 */
Amon.prototype.putMonitor = function(customer, monitor, callback) {
  if (!customer) {
    throw new TypeError('customer is required');
  }

  if (!monitor || typeof monitor !== 'object') {
    throw new TypeError('monitor is required (object)');
  }

  if (!monitor.name || !monitor.contacts) {
    throw new TypeError('monitor must contain name and contact fields');
  }

  this._validateCallback(callback);

  var self = this;
  var request = {
    path: sprintf(MONITOR_FMT, customer, monitor.name),
    body: monitor
  };

  return this.client.put(request, function(err, obj, header) {
    if (err) {
      return callback(self._translateError(err));
    }

    return callback(null, obj);
  });
};


/**
 * Deletes a monitor from Amon by monitor name.
 *
 * @param {String} customer : the customer uuid.
 * @param {String} monitorName : the name of the monitor.
 * @param {Function} callback of the form f(err).
 */
Amon.prototype.deleteMonitor = function(customer, monitorName, callback) {
  if (!customer) {
    throw new TypeError('customer is required');
  }

  if (!monitorName) {
    throw new TypeError('monitorName is required');
  }

  this._validateCallback(callback);

  var self = this;
  var request = {
    path: sprintf(MONITOR_FMT, customer, monitorName),
    expect: [200, 202, 204]
  };

  return this.client.del(request, function(err) {
    if (err) {
      return callback(self._translateError(err));
    }

    return callback(null);
  });
};


/**
 * List probes by customer and monitor name.
 *
 * @param {String} customer : the customer uuid.
 * @param {String} monitorName : the name of the monitor.
 * @param {Function} callback : call of the form f(err, probes).
 */
Amon.prototype.listProbes = function(customer, monitorName, callback) {
  if (!customer) {
    throw new TypeError('customer is required');
  }

  if (!monitorName) {
    throw new TypeError('monitorName is required');
  }

  this._validateCallback(callback);

  var self = this;
  var request = {
    path: sprintf(PROBE_BASE_FMT, customer, monitorName)
  };

  return this.client.get(request, function(err, obj, headers) {
    if (err) {
      return callback(self._translateError(err));
    }

    return callback(null, obj);
  });
};


/**
 * Creates a probe for a monitor.
 * @param {String} customer : The customer UUID.
 * @param {String} monitorName : The name of the monitor.
 * @param {Object} probe : The probe, should contain the following
 * {
 *  "zone": "global",
 *  "urn": "amon:logscan",
 *  "data": {
 *    "path": "/tmp/whistle.log",
 *    "regex": "tweet",
 *    "threshold": 2,
 *    "period": 60
 *   }
 * }.
 */
Amon.prototype.putProbe = function(customer, monitorName, probe, callback) {
  if (!customer) {
    throw new TypeError('customer is required');
  }

  if (!monitorName) {
    throw new TypeError('monitorName is required');
  }

  if (!probe || typeof probe != 'object') {
    throw new TypeError('probe is required (object)');
  }

  //TODO: add more fine-grained probe.data validation once the data fields have
  // been fleshed out.
  if (!probe.name || !probe.user || !probe.monitor ||
      !probe.zone || !probe.urn || !probe.data)
  {
    throw new TypeError('probe must contain name, user, monitor, zone, urn, ' +
        'and data fields');
  }

  var self = this;
  var request = {
    path: sprintf(PROBE_FMT, customer, monitorName, probe.name),
    body: probe
  };

  return this.client.put(request, function(err, obj, header) {
    if (err) {
      return callback(self._translateError(err));
    }

    return callback(null, obj);
  });
};


/**
 * Deletes a probe from Amon.
 *
 * @param {String} customer : the customer uuid.
 * @param {String} monitorName : the name of the monitor.
 * @param {String} probeName : the name of the probe.
 * @param {Function} callback of the form f(err).
 */
Amon.prototype.deleteProbe = function(customer, monitorName,
                                      probeName, callback)
    {
  if (!customer) {
    throw new TypeError('customer is required');
  }

  if (!monitorName) {
    throw new TypeError('monitorName is required');
  }

  if (!probeName) {
    throw new TypeError('probeName is required');
  }

  this._validateCallback(callback);

  var self = this;
  var request = {
    path: sprintf(PROBE_FMT, customer, monitorName, probeName),
    expect: [200, 202, 204]
  };

  return this.client.del(request, function(err) {
    if (err) {
      return callback(self._translateError(err));
    }

    return callback(null);
  });
};


/**
 * Gets probe.
 *
 * @param {String} customer : the customer uuid.
 * @param {String} monitorName : the name of the monitor.
 * @param {String} probeName : the name of the probe.
 * @param {Function} callback of the form f(err, account).
 */
Amon.prototype.getProbe = function(customer, monitorName, probeName, callback) {
  if (!customer) {
    throw new TypeError('customer is required');
  }

  if (!monitorName) {
    throw new TypeError('monitorName is required');
  }

  if (!probeName) {
    throw new TypeError('probeName is required');
  }

  this._validateCallback(callback);

  var self = this;
  var request = {
    path: sprintf(PROBE_FMT, customer, monitorName, probeName)
  };

  return this.client.get(request, function(err, obj, header) {
    if (err) {
      return callback(self._translateError(err));
    }

    return callback(null, obj);
  });
};

Amon.prototype._validateCallback = function(callback) {
  if (!callback || typeof(callback) !== 'function') {
    throw new TypeError('callback is required (function)'); }
};

Amon.prototype._translateError = function(err) {
  assert.ok(err);

  function _getMessage() {
    var msg = null;
    if (err.details && err.details.object && err.details.object.errors) {
      if (Array.isArray(err.details.object.errors)) {
        msg = err.details.object.errors[0];
      } else {
        msg = err.details.object.errors;
      }
    }
    return msg;
  }

  switch (err.httpCode) {
    case 400:
    case 409:
      err = newError({
        httpCode: HttpCodes.Conflict,
        restCode: RestCodes.InvalidArgument,
        message: _getMessage() || 'Invalid Argument',
        error: err
      });
      break;
    case 404:
      err = newError({
        httpCode: HttpCodes.NotFound,
        restCode: RestCodes.ResourceNotFound,
        message: _getMessage() || 'Not found',
        error: err
      });
      break;
    default:
    // noop?
    break;
  }
  return err;
};

module.exports = Amon;
