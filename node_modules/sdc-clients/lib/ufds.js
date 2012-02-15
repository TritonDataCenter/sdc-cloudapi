// Copyright 2011 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var httpSignature = require('http-signature');
var ldap = require('ldapjs');
var restify = require('restify');
var sprintf = require('sprintf').sprintf;
var uuid = require('node-uuid');

var cache = require('./cache');



///--- Globals

var InvalidCredentialsError = restify.InvalidCredentialsError;
var NotAuthorizedError = restify.NotAuthorizedError;
var ResourceNotFoundError = restify.ResourceNotFoundError;

var getFingerprint = httpSignature.sshKeyFingerprint;

var HIDDEN = new ldap.Control({
  type: '1.3.6.1.4.1.38678.1',
  criticality: true
});

var SUFFIX = 'o=smartdc';

var GROUPS = 'ou=groups, ' + SUFFIX;
var GROUP_FMT = 'cn=%s, ' + GROUPS;
var ADMIN_GROUP = sprintf(GROUP_FMT, 'operators');

var USERS = 'ou=users, ' + SUFFIX;
var USER_FMT = 'uuid=%s, ' + USERS;
var KEY_FMT = 'fingerprint=%s, ' + USER_FMT;
var LIMIT_FMT = 'dclimit=%s, ' + USER_FMT;



///--- Helpers

function clone(from) {
  assert.equal(typeof(from), 'object');

  function newVal(val) {
    if (typeof(val) === 'object') {
      if (Array.isArray(val)) {
        var copy = [];
        val.forEach(function(v) {
          copy.push(typeof(v) === 'object' ? clone(v) : v);
        });
      } else {
        copy = clone(val);
      }
    } else {
      copy = val;
    }
    return copy;
  }

  var dest;
  if (Array.isArray(from)) {
    dest = [];
    from.forEach(function(v) {
      dest.push(newVal(v));
    });
  } else {
    dest = {};
    Object.keys(from).forEach(function(k) {
      dest[k] = newVal(from[k]);
    });
  }

  return dest;
}



///--- Exported API

/**
 * Constructor.
 *
 * @param {Object} options options object:
 *                  - url {String} UFDS location.
 *                  - bindDN {String} admin bind DN for UFDS.
 *                  - password {String} password to said admin DN.
 *                  - cache {Object} age (default 60s) and size (default 1k).
 *                                   use false to disable altogether.
 */
function UFDS(options) {
  if (typeof(options) !== 'object')
    throw new TypeError('options (Object) required');
  if (typeof(options.url) !== 'string')
    throw new TypeError('options.url (String) required');

  var self = this;
  EventEmitter.call(this);

  if (options.cache !== false)
    this.cache = cache.createCache(options.cache);

  this.client = ldap.createClient(options);

  if (!options.bindDN || !options.bindPassword) {
    this.emit('ready', false);
  } else {
    this.client.bind(options.bindDN, options.bindPassword, function(err) {
      if (err)
        self.emit('error', err);

      self.emit('ready', true);
    });
  }

  this.client.on('close', function(had_err) {
    self.emit('close', had_err);
  });

  this.__defineGetter__('cacheOptions', function() {
    return options.cache || false;
  });
}
util.inherits(UFDS, EventEmitter);
module.exports = UFDS;


/**
 * Unbinds the underlying LDAP client.
 *
 * @param {Function} callback of the form f(err).
 */
UFDS.prototype.close = function close(callback) {
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  var self = this;
  this.client.unbind(function(err) {
    if (err)
      return callback(self._translateError(err));

    return callback(null);
  });
};


/**
 * Checks a user's password in UFDS.
 *
 * Returns a RestError of '401' if password mismatches. Returns the same user
 * object as getUser on success.
 *
 * @param {String} login one of login, uuid or the result of getUser.
 * @param {String} password correct password.
 * @param {Function} callback of the form fn(err, user).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.authenticate = function authenticate(login, password, callback) {
  if (typeof(login) !== 'string' && typeof(login) !== 'object')
    throw new TypeError('login (String) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  var self = this;
  var cacheKey = login + ':' + password;
  var entry;
  if (this.cache && (entry = this.cache.get(cacheKey)))
    return callback(null, entry);

  function _compare(user) {
    self.client.compare(user.dn, 'userpassword', password, function(err, ok) {
      if (err)
        return callback(self._translateError(err));

      if (!ok)
        return callback(new InvalidCredentialsError('The credentials ' +
                                                    'provided are invalid'));


      if (self.cache)
        self.cache.put(cacheKey, user);

      return callback(null, user);
    });
  }

  if (typeof(login) === 'object')
    return _compare(login);

  return this.getUser(login, function(err, user) {
    if (err)
      return callback(err);

    return _compare(user);
  });
};


/**
 * Adds a new user into UFDS.
 *
 * This call expects the user object to look like the `sdcPerson` UFDS
 * schema, minus objectclass/dn/uuid.
 *
 * @param {Object} user the entry to add.
 * @param {Function} callback of the form fn(err, user).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.addUser = function addUser(user, callback) {
  if (typeof(user) !== 'object')
    throw new TypeError('user (Object) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  var self = this;

  user.uuid = uuid();
  user.objectclass = 'sdcperson';

  return this.add(sprintf(USER_FMT, user.uuid), user, function(err) {
    if (err)
      return callback(err);

    return self.getUser(user.uuid, function(err, user) {
      if (err)
        return callback(err);

      return callback(null, user);
    });
  });
};


/**
 * Looks up a user by login to UFDS.
 *
 * @param {String} login (or uuid) for a customer.
 * @param {Object} options (optional).
 * @param {Function} callback of the form f(err, user).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.getUser = function getUser(login, callback) {
  if (typeof(login) !== 'string' && typeof(login) !== 'object')
    throw new TypeError('login (String) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  if (typeof(login) === 'object')
    return callback(null, login);

  var self = this;

  // UFDS is bad at '|' filters, so just fire two searches off
  var count = 0;
  var done = false;
  var error;

  function _callback(err, entries) {
    if (done)
      return false;

    if (entries && entries.length) {
      done = true;
      return callback(null, self._extendUser(entries[0]));
    }

    if (err)
      error = error || err;

    if (++count == 2) {
      done = true;
      if (error)
        return callback(error);

      var msg = login + ' does not exist';
      return callback(error || new ResourceNotFoundError(msg));
    }

    return false;
  }

  var optsLogin = {
    scope: 'one',
    attributes: ['*', 'memberof'],
    filter: sprintf('(&(login=%s)(objectclass=sdcperson))', login)
  };

  // This is a little goofy; we decide whether or not to issue another
  // search request based on the status of the callback above
  this.search(USERS, optsLogin, _callback);
  if (!done) {
    var optsUuid = {
      scope: 'base',
      attributes: ['*', 'memberof'],
      filter: sprintf('(&(uuid=%s)(objectclass=sdcperson))', login)
    };
    this.search(sprintf(USER_FMT, login), optsUuid, _callback);
  }

  return false;
};


/**
 * Updates a user record.
 *
 * @param {Object} user the user record you got from getUser.
 * @param {Object} changes the plain object you want merged in.
 * @param {Function} callback of the form fn(err, user).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.updateUser = function updateUser(user, changes, callback) {
  if (typeof(user) !== 'string' && typeof(user) !== 'object')
    throw new TypeError('user (Object) required');
  if (typeof(changes) !== 'object')
    throw new TypeError('changes (Object) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  var self = this;
  function _callback(user) {
    var _changes = [];
    Object.keys(changes).forEach(function(k) {
      if (k === 'dn' ||
          k === 'objectclass' ||
          k === 'memberof' ||
          k === 'uuid' ||
          user[k] === changes[k] ||
          typeof(changes[k]) === 'function')
        return;

      var change = {
        type: 'replace',
        modification: {}
      };
      if (user[k] && !changes[k]) {
        change.type = 'delete';
        change.modification[k] = [];
      } else {
        change.modification[k] = changes[k];
      }

      _changes.push(change);
    });

    if (!_changes.length)
      return callback(null);

    return self.modify(user.dn, _changes, callback);
  }

  // Force us to retrieve the user from backend so we can check the delta
  if (typeof(user) === 'object')
    user = user.login;

  return this.getUser(user, function(err, user) {
    if (err)
      return callback(err);

    return _callback(user);
  });
};


/**
 * Deletes a user record.
 *
 * @param {Object} user the user record you got from getUser.
 * @param {Function} callback of the form fn(err, user).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.deleteUser = function deleteUser(user, callback) {
  if (typeof(user) !== 'string' && typeof(user) !== 'object')
    throw new TypeError('user (Object) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  var self = this;
  function _callback(user) {
    return self.del(user.dn, callback);
  }

  if (typeof(user) === 'object')
    return _callback(user);

  return this.getUser(user, function(err, user) {
    if (err)
      return callback(err);

    return _callback(user);
  });
};


/**
 * Adds a new SSH key to a given user record.
 *
 * You can either pass in an SSH public key (string) or an object of the form
 *
 * {
 *   name: foo,
 *   openssh: public key
 * }
 *
 * This method will return you the full key as processed by UFDS. If you don't
 * pass in a name, then the name gets set to the fingerprint of the SSH key.
 *
 * @param {Object} user the user record you got from getUser.
 * @param {String} key the OpenSSH public key.
 * @param {Function} callback of the form fn(err, key).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.addKey = function addKey(user, key, callback) {
  if (typeof(user) !== 'string' && typeof(user) !== 'object')
    throw new TypeError('user (Object) required');
  if (typeof(key) !== 'string' && typeof(key) !== 'object')
    throw new TypeError('key (String) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');
  if (typeof(key) === 'string')
    key = { openssh: key };
  if (typeof(key.openssh) !== 'string')
    throw new TypeError('key.openssh (String) required');

  var self = this;

  function _addKey(user) {
    var fingerprint = getFingerprint(key.openssh);
    var dn = sprintf(KEY_FMT, fingerprint, user.uuid);
    var entry = {
      openssh: key.openssh,
      fingerprint: fingerprint,
      name: key.name || fingerprint,
      objectclass: 'sdckey'
    };

    return self.add(dn, entry, function(err) {
      if (err)
        return callback(self._translateError(err));

      return self.getKey(user, fingerprint, callback);
    });
  }

  if (typeof(user) === 'object')
    return _addKey(user);

  return this.getUser(user, function(err, user) {
    if (err)
      return callback(err);

    return _addKey(user);
  });
};


/**
 * Retrieves an SSH key by fingerprint.
 *
 * @param {Object} user the object you got back from getUser.
 * @param {String} fingerprint the SSH fp (or name) of the SSH key you want.
 * @param {Function} callback of the form fn(err, key).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.getKey = function getKey(user, fingerprint, callback) {
  if (typeof(user) !== 'string' && typeof(user) !== 'object')
    throw new TypeError('user (Object) required');
  if (typeof(fingerprint) !== 'string')
    throw new TypeError('fingerprint (String) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  return this.listKeys(user, function(err, keys) {
    if (err)
      return callback(err);

    var key;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].fingerprint === fingerprint || keys[i].name === fingerprint) {
        key = keys[i];
        break;
      }
    }

    if (!key)
      return callback(new ResourceNotFoundError(fingerprint +
                                                ' does not exist'));

    return callback(null, key);
  });
};


/**
 * Loads all keys for a given user.
 *
 * @param {Object} user the user you got from getUser.
 * @param {Function} callback of the form fn(err, keys).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.listKeys = function listKeys(user, callback) {
  if (typeof(user) !== 'string' && typeof(user) !== 'object')
    throw new TypeError('user (Object) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  var self = this;
  function _keys(user) {
    var opts = {
      scope: 'one',
      filter: '(objectclass=sdckey)'
    };
    self.search(user.dn, opts, function(err, keys) {
      if (err)
        return callback(err);

      return callback(null, keys);
    });
  }

  if (typeof(user) === 'object')
    return _keys(user);

  return self.getUser(user, function(err, user) {
    if (err)
      return callback(err);

    return _keys(user);
  });
};


/**
 * Deletes an SSH key under a user.
 *
 * @param {User} the object you got back from getUser.
 * @param {Object} key the object you got from getKey.
 * @param {Function} callback of the form fn(err, key).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.deleteKey = function deleteKey(user, key, callback) {
  if (typeof(user) !== 'string' && typeof(user) !== 'object')
    throw new TypeError('user (Object) required');
  if (typeof(key) !== 'object' && typeof(key) !== 'string')
    throw new TypeError('key (Object) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  var self = this;
  function _delKey(user, key) {
    if (!ldap.parseDN(user.dn).parentOf(key.dn))
      return callback(new NotAuthorizedError(key.dn +
                                             ' is not a child of ' + user.dn));

    return self.del(key.dn, function(err) {
      if (err)
        return callback(err);

      return callback(null);
    });
  }

  function _getKey(user) {
    if (typeof(key) === 'object')
      return _delKey(user, key);

    return self.getKey(user, key, function(err, key) {
      if (err)
        return callback(err);

      return _delKey(user, key);
    });
  }

  if (typeof(user) === 'object')
    return _getKey(user);

  return self.getUser(user, function(err, user) {
    if (err)
      return callback(err);

    return _getKey(user);
  });
};


/**
 * Lists "CAPI" limits for a given user.
 *
 * @param {Object} user the object returned from getUser.
 * @param {Function} callback of the form fn(err, limits).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.listLimits = function listLimits(user, callback) {
  if (typeof(user) !== 'string' && typeof(user) !== 'object')
    throw new TypeError('user (Object) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  var self = this;
  function _limits(user) {
    var opts = {
      scope: 'one',
      filter: '(objectclass=capilimit)'
    };
    self.search(user.dn, opts, function(err, limits) {
      if (err)
        return callback(err);

      return callback(null, limits);
    });
  }

  if (typeof(user) === 'object')
    return _limits(user);

  return self.getUser(user, function(err, user) {
    if (err)
      return callback(err);

    return _limits(user);
  });
};


/**
 * Gets a "CAPI" limit for a given user.
 *
 * @param {Object} user the object returned from getUser.
 * @param {String} datacenter the datacenter name.
 * @param {Function} callback of the form fn(err, limits).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.getLimit = function getLimit(user, datacenter, callback) {
  if (typeof(user) !== 'string' && typeof(user) !== 'object')
    throw new TypeError('user (Object) required');
  if (typeof(datacenter) !== 'string' && typeof(datacenter) !== 'object')
    throw new TypeError('datacenter (Object) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  if (typeof(datacenter) === 'object')
    return callback(null, datacenter);

  var self = this;
  function _limits(user) {
    self.listLimits(user, function(err, limits) {
      if (err)
        return callback(err);

      for (var i = 0; i < limits.length; i++) {
        if (limits[i].datacenter === datacenter)
          return callback(null, limits[i]);
      }

      return callback(new ResourceNotFoundError('No limit found for ' +
                                                user.login + '/' + datacenter +
                                                '.'));
    });
  }

  if (typeof(user) === 'object')
    return _limits(user);

  return self.getUser(user, function(err, user) {
    if (err)
      return callback(err);

    return _limits(user);
  });
};


/**
 * Creates a "CAPI"" limit for a given user.
 *
 * @param {Object} user the object returned from getUser.
 * @param {Object} limit the limit to add.
 * @param {Function} callback of the form fn(err, limits).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.addLimit = function addLimit(user, limit, callback) {
  if (typeof(user) !== 'string' && typeof(user) !== 'object')
    throw new TypeError('user (Object) required');
  if (typeof(limit) !== 'object')
    throw new TypeError('limit (Object) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');
  if (typeof(limit.datacenter) !== 'string')
    throw new TypeError('limit.datacenter (String) required');

  var self = this;
  function _add(user) {
    var dn = sprintf(LIMIT_FMT, limit.datacenter, user.uuid);
    var entry = {
      objectclass: 'capilimit'
    };

    Object.keys(limit).forEach(function(k) {
      entry[k] = limit[k];
    });

    return self.add(dn, entry, function(err) {
      if (err)
        return callback(self._translateError(err));

      return self.getLimit(user, limit.datacenter, callback);
    });
  }

  if (typeof(user) === 'object')
    return _add(user);

  return self.getUser(user, function(err, user) {
    if (err)
      return callback(err);

    return _add(user);
  });
};


/**
 * Creates a "CAPI"" limit for a given user.
 *
 * @param {Object} user the object returned from getUser.
 * @param {Object} limit the limit to add.
 * @param {Function} callback of the form fn(err, limits).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.updateLimit = function updateLimit(user, limit, callback) {
  if (typeof(user) !== 'string' && typeof(user) !== 'object')
    throw new TypeError('user (Object) required');
  if (typeof(limit) !== 'object')
    throw new TypeError('limit (Object) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');
  if (typeof(limit.datacenter) !== 'string')
    throw new TypeError('limit.datacenter (String) required');

  var self = this;
  function _mod(user, _limit) {
    var dn = sprintf(LIMIT_FMT, limit.datacenter, user.uuid);
    var changes = [];
    Object.keys(limit).forEach(function(k) {
      if (k === 'dn' ||
          k === 'objectclass' ||
          typeof(limit[k]) === 'function' ||
          limit[k] === _limit[k])
        return;

      var change = {
        type: 'replace',
        modification: {}
      };
      if (_limit[k] && !limit[k]) {
        change.type = 'delete';
        change.modification[k] = [];
      } else {
        change.modification[k] = limit[k];
      }
      changes.push(change);
    });

    if (!changes.length)
      return callback(null);

    return self.modify(dn, changes, callback);
  }

  function _limit(user) {
    return self.getLimit(user, limit.datacenter, function(err, limit) {
      if (err)
        return callback(err);

      return _mod(user, limit);
    });
  }

  if (typeof(user) === 'object')
    return _limit(user);

  return self.getUser(user, function(err, user) {
    if (err)
      return callback(err);

    return _limit(user);
  });
};


/**
 * Deletes a "CAPI"" limit for a given user.
 *
 * Note that this deletes _all_ limits for a datacenter, so if you just want
 * to purge one, you probably want to use updateLimit.
 *
 * @param {Object} user the object returned from getUser.
 * @param {Object} limit the limit to delete.
 * @param {Function} callback of the form fn(err).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.deleteLimit = function deleteLimit(user, limit, callback) {
  if (typeof(user) !== 'string' && typeof(user) !== 'object')
    throw new TypeError('user (Object) required');
  if (typeof(limit) !== 'object')
    throw new TypeError('limit (Object) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');
  if (typeof(limit.datacenter) !== 'string')
    throw new TypeError('limit.datacenter (String) required');

  var self = this;
  function _del(user) {
    var dn = sprintf(LIMIT_FMT, limit.datacenter, user.uuid);
    return self.del(dn, callback);
  }

  if (typeof(user) === 'object')
    return _del(user);

  return self.getUser(user, function(err, user) {
    if (err)
      return callback(err);

    return _del(user);
  });
};


/**
 * Low-level API to wrap up UFDS add operations.
 *
 * See ldapjs docs.
 *
 * @param {String} dn of the record to add.
 * @param {Object} entry record attributes.
 * @param {Function} callback of the form fn(error, entries).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.add = function add(dn, entry, callback) {
  if (typeof(dn) !== 'string')
    throw new TypeError('dn (String) required');
  if (typeof(entry) !== 'object')
    throw new TypeError('entry (Object) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  var self = this;
  this.client.once('error', function(err) {
    return callback(self._translateError(err));
  });
  return this.client.add(dn, entry, function(err) {
    if (err)
      return callback(self._translateError(err));

    self._newCache();

    return callback(null);
  });
};


/**
 * Low-level API to wrap up UFDS delete operations.
 *
 * See ldapjs docs.
 *
 * @param {String} dn dn to delete.
 * @param {Function} callback of the form fn(error).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.del = function del(dn, callback) {
  if (typeof(dn) !== 'string')
    throw new TypeError('dn (String) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  var self = this;
  this.client.once('error', function(err) {
    return callback(self._translateError(err));
  });
  return this.client.del(dn, function(err) {
    if (err)
      return callback(self._translateError(err));

    self._newCache();
    return callback(null);
  });
};


/**
 * Low-level API to wrap up UFDS modify operations.
 *
 * See ldapjs docs.
 *
 * @param {String} dn to update
 * @param {Object} changes to make.
 * @param {Function} callback of the form fn(error).
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.modify = function modify(dn, changes, callback) {
  if (typeof(dn) !== 'string')
    throw new TypeError('dn (String) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  var self = this;
  this.client.once('error', function(err) {
    return callback(self._translateError(err));
  });
  return this.client.modify(dn, changes, function(err) {
    if (err)
      return callback(self._translateError(err));

    self._newCache();
    return callback(null);
  });
};


/**
 * Low-level API to wrap up UFDS search operations.
 *
 * See ldapjs docs.
 *
 * @param {String} base search base.
 * @param {Object} options search options.
 * @param {Function} callback of the form fn(error, entries).
 * @return {Boolean} true if callback was invoked from cache, false if not.
 * @throws {TypeError} on bad input.
 */
UFDS.prototype.search = function search(base, options, callback) {
  if (typeof(base) !== 'string')
    throw new TypeError('base (String) required');
  if (typeof(options) !== 'object')
    throw new TypeError('options (Object) required');
  if (typeof(callback) !== 'function')
    throw new TypeError('callback (Function) required');

  var self = this;
  var key = base + '::' + JSON.stringify(options);
  var entries;
  if ((entries = (this.cache ? this.cache.get(key) : false))) {
    callback(null, clone(entries));
    return true;
  }

  return this.client.search(base, options, HIDDEN, function(err, res) {
    if (err)
      return callback(self._translateError(err));

    res.on('searchEntry', function(entry) {
      if (!entries)
        entries = [];
      if (Array.isArray(entries))
        entries.push(entry.object);
    });
    res.on('error', function(err) {
      return callback(self._translateError(err));
    });
    res.on('end', function() {
      if (entries && entries.length && self.cache)
        self.cache.put(key, entries);

      return callback(null, entries ? clone(entries) : []);
    });

    return false;
  });
};


/**
 * Convenience mechanism to set the LDAP log level.
 *
 * @param {String} level see Log4js levels.
 */
UFDS.prototype.setLogLevel = function setLogLevel(level) {
  this.client.log4js.setGlobalLogLevel(level);
};


///--- "Private" methods

UFDS.prototype._newCache = function _newCache() {
  this.cache = null;
  if (this.cacheOptions)
    this.cache = cache.createCache(this.cacheOptions);
};


UFDS.prototype._translateError = function _translateError(error) {
  if (error instanceof restify.HttpError)
    return error;

  if (error instanceof ldap.LDAPError) {
    switch (error.name) {

    case 'NoSuchAttributeError':
    case 'NoSuchObjectError':
    case 'UndefinedAttributeTypeError':
      return new ResourceNotFoundError('The resource you requested does ' +
                                       'not exist');

    case 'InvalidDnSyntax':
    case 'AttributeOrValueExistsError':
    case 'ConstriantViolationError':
      return new restify.InvalidArgumentError(error.message);
    case 'EntryAlreadyExistsError':
      return new restify.InvalidArgumentError(error.message +
                                              ' already exists');

    case 'ObjectclassViolationError':
      return new restify.MissingParameterError('Request is missing a ' +
                                               'required parameter');

    case 'NotAllowedOnNonLeafError':
    case 'NotAllowedOnRdnError':
      return new restify.InvalidArgumentError('The resource in question has ' +
                                              '"child" elements');

    default:
      break;
    }
  }

  return new restify.InternalError(error.message);
};


UFDS.prototype._extendUser = function _extendUser(user) {
  assert.equal(typeof(user), 'object');

  var self = this;

  if (!user.memberof)
    user.memberof = [];
  if (!Array.isArray(user.memberof))
    user.memberof = [user.memberof];


  user.authenticate = function authenticate(password, callback) {
    return self.authenticate(user, password, function(err, user) {
      if (err)
        return callback(err);

      return callback();
    });
  };
  user.isAdmin = function isAdmin() {
    return (user.memberof.indexOf(ADMIN_GROUP) !== -1);
  };

  user.groups = function groups() {
    var groups = [];
    user.memberof.forEach(function(g) {
      var rdns = ldap.parseDN(g).rdns;
      if (rdns && rdns.length && rdns[0].cn)
        groups.push(rdns[0].cn);
    });
    return groups;
  };

  user.addKey = function addKey(key, callback) {
    return self.addKey(user, key, callback);
  };
  user.getKey = function getKey(fingerprint, callback) {
    return self.getKey(user, fingerprint, callback);
  };
  user.listKeys = function listKeys(callback) {
    return self.listKeys(user, callback);
  };
  user.deleteKey = function deleteKey(key, callback) {
    return self.deleteKey(user, key, callback);
  };

  user.addLimit = function addLimit(limit, callback) {
    return self.addLimit(user, limit, callback);
  };
  user.getLimit = function getLimit(datacenter, callback) {
    return self.getLimit(user, datacenter, callback);
  };
  user.listLimits = function listLimits(callback) {
    return self.listLimits(user, callback);
  };
  user.updateLimit = function updateLimit(limit, callback) {
    return self.updateLimit(user, limit, callback);
  };
  user.deleteLimit = function deleteLimit(limit, callback) {
    return self.deleteLimit(user, limit, callback);
  };

  user.update = user.save = function save(callback) {
    return self.updateUser(user, user, callback);
  };
  user.destroy = function destroy(callback) {
    return self.deleteUser(user, callback);
  };

  return user;
};
