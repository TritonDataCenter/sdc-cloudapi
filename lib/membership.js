/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Main goal of this file is to prevent cyclic dependencies between
 * roles.js and users.js. Both, roles and users, will point to the other;
 * thereby, the circular dependency loop could be easily hit if we don't
 * take care of it in advance.
 */


var assert  = require('assert');
var restify = require('restify');
var sprintf = require('util').format;
var vasync  = require('vasync');

var USER_FMT = 'uuid=%s, ou=users, o=smartdc';

/**
 * UFDS to CloudAPI account.
 *
 * @param {Object} user UFDS user (sdcPerson + sdcAccountUser)
 * @return {Object} user CloudAPI user.
 */
function translateUser(user) {
    if (!user) {
        return {};
    }

    var u = {
        id: user.uuid,
        login: user.login,
        email: user.email
    };

    if (user.company) {
        u.companyName = user.company;
    }

    if (user.givenname) {
        u.firstName = user.givenname;
    }
    if (user.sn) {
        u.lastName = user.sn;
    }
    if (user.postalcode) {
        u.postalCode = user.postalcode;
    }

    ['address', 'city', 'state', 'roles', 'default_roles',
        'postalCode', 'country', 'phone'].forEach(function (p) {
            if (user[p]) {
                u[p] = user[p];
            }
        });

    u.updated = user.updated_at || 1356994800000;
    u.updated = new Date(parseInt(u.updated, 0)).toISOString();
    // If created_at has no value, set by default to
    // "Tue Jan 01 2013 00:00:00 GMT+0100 (CET)" as "the beginning day"
    u.created = user.created_at || 1356994800000;
    u.created = new Date(parseInt(u.created, 0)).toISOString();

    return (u);
}


/**
 * Preload (and cache into the request object) the given users.
 *
 * Returns an Array of CloudAPI -UFDS- users.
 *
 * @param {Object} req (required) the current request object.
 * @param {Array} names of the users to retrieve. This array
 *  can contain either the names, the UUIDs or the DNs of the users.
 * @param {Object} options optional set of search options. Notably, the
 *  @property {string} options.searchby (optional) must be provided when the
 *  given array of names contains DNs or UUIDs. For these cases, the values of
 *  options.searchby must be, respectively, 'dn' or 'uuid'.
 * @param {Function} cb callback if the form f(err, users)
 * @throws {TypeError} on bad input.
 */
function preloadUsers(req, names, options, cb) {
    assert.ok(req.sdc);
    assert.ok(req.account);
    assert.ok(names.length);

    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    // Avoid re-loading already loaded users
    var cached = [];
    if (!req.cache) {
        req.cache = {};
    }
    if (!req.cache.users) {
        req.cache.users = {};
    }

    if (typeof (options) === 'function') {
        cb = options;
        options = {};
    }

    if (!options.searchby) {
        options.searchby = 'login';
    }

    if (options.searchby === 'dn') {
        names = names.map(function (m) {
            /* JSSTYLED */
            var RE = /^uuid=([^,]+)/;
            var res = RE.exec(m);
            if (res !== null) {
                return (res[1]);
            } else {
                return m;
            }
        });
        options.searchby = 'uuid';
    }

    // Lokup cache here, and skip users already preloaded:
    names = names.filter(function (n) {
        if (req.cache.users[n]) {
            cached.push(req.cache.users[n]);
            return false;
        } else {
            return true;
        }
    });

    // At this point, if we've loaded all the users we could return:
    if (!names.length) {
        return cb(null, cached);
    }

    if (options.searchby === 'login') {
        names = names.map(function (n) {
            return (id + '/' + n);
        });
    }

    var filter;

    if (names.length === 1) {
        filter = '(&(objectclass=sdcaccountuser)(' + options.searchby + '=' +
                    names[0] + '))';
    } else {
        filter = '(&(objectclass=sdcaccountuser)(|(' + options.searchby + '=' +
                    names.join(')(' + options.searchby + '=') + ')))';
    }


    var opts = {
        scope: 'one',
        filter: filter
    };

    var dn = sprintf(USER_FMT, id);
    return ufds.search(dn, opts, function (err, users) {
        if (err) {
            cb(err);
        } else {
            users = users.map(translateUser);
            // Store into cache, just in case we may need them later:
            users.forEach(function (u) {
                req.cache.users[u.id] = req.cache.users[u.login] = u;
            });
            // Finally, if we had already preloaded users, merge here:
            if (cached.length) {
                users = users.concat(cached);
            }
            cb(null, users);
        }
    });
}

/**
 * UFDS to CloudAPI role.
 *
 * @param {Object} req current request
 * @param {Object} group UFDS role (sdcAccountRole)
 * @param {function} cb of the form f(err, role)
 * @return {Object} role.
 */
function translateGroup(req, group, cb) {
    assert.ok(req.sdc);

    var pipeline_funcs = [];
    var r = {
        name: group.name,
        id: group.uuid,
        members: group.uniquemember || [],
        default_members: group.uniquememberdefault || [],
        policies: group.memberpolicy || []
    };

    if (typeof (r.members) === 'string') {
        r.members = [r.members];
    }

    if (typeof (r.default_members) === 'string') {
        r.default_members = [r.default_members];
    }

    if (typeof (r.policies) === 'string') {
        r.policies = [r.policies];
    }

    if (r.members.length) {
        pipeline_funcs.push(function _loadMembers(_, _cb) {
            /* JSSTYLED */
            var RE = /^uuid=([^,]+)/;
            var res = RE.exec(r.members[0]);
            preloadUsers(req, r.members, {
                searchby: (res !== null) ? 'dn' : 'uuid'
            }, function (err, users) {
                if (err) {
                    return _cb(err);
                }
                r.members = users;
                return _cb(null);
            });
        });
    }

    if (r.default_members.length) {
        pipeline_funcs.push(function _loadDefaultMembers(_, _cb) {
            /* JSSTYLED */
            var RE = /^uuid=([^,]+)/;
            var res = RE.exec(r.default_members[0]);
            preloadUsers(req, r.default_members, {
                searchby: (res !== null) ? 'dn' : 'uuid'
            }, function (err, users) {
                if (err) {
                    return _cb(err);
                }
                r.default_members = users;
                return _cb(null);
            });
        });
    }


    if (r.policies.length) {
        pipeline_funcs.push(function _loadPolicies(_, _cb) {
            /* JSSTYLED */
            var RE = /^policy\-uuid=([^,]+)/;
            var res = RE.exec(r.policies[0]);
            require('./policies').preloadPolicies(req, r.policies, {
                searchby: (res !== null) ? 'dn' : 'uuid'
            }, function (err, policies) {
                if (err) {
                    return _cb(err);
                }
                r.policies = policies;
                return _cb(null);
            });
        });
    }


    if (pipeline_funcs.length) {
        pipeline_funcs.push(function _translate(_, _cb) {
            r.policies = r.policies.map(function (policy) {
                return (policy.name);
            });

            r.default_members = r.default_members.map(function (member) {
                return (member.login);
            });

            r.members = r.members.map(function (member) {
                return (member.login);
            });

            return _cb(null);
        });

        vasync.pipeline({
            funcs: pipeline_funcs
        }, function (err, results) {
            if (err) {
                return cb(err);
            }
            return cb(null, r);
        });
    } else {
        cb(null, r);
    }
}


/**
 * Preload (and cache into the request object) the given groups.
 *
 * Returns an Array of UFDS roles.
 *
 * @param {Object} req (required) the current request object.
 * @param {Array} names an array of names of the groups to retrieve. This array
 *  can contain either the names, the UUIDs or the DNs of the groups.
 * @param {Object} options optional set of search options. Notably, the
 *  @property {string} options.searchby (optional) must be provided when the
 *  given array of names contains DNs or UUIDs. For these cases, the values of
 *  options.searchby must be, respectively, 'dn' or 'uuid'.
 * @param {Function} cb callback if the form f(err, groups)
 * @throws {TypeError or InvalidArgumentError} on bad input.
 */
function preloadGroups(req, names, options, cb) {
    assert.ok(req.sdc);
    assert.ok(req.account);
    assert.ok(names.length);

    if (typeof (options) === 'function') {
        cb = options;
        options = {};
    }

    if (!options.searchby) {
        options.searchby = 'name';
    }

    if (options.searchby === 'dn') {
        names = names.map(function (m) {
            /* JSSTYLED */
            var RE = /^role\-uuid=([^,]+)/;
            var res = RE.exec(m);
            if (res !== null) {
                return (res[1]);
            } else {
                return m;
            }
        });
        options.searchby = 'uuid';
    }

    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;
    var filter;

    if (!names.length) {
        filter = '(objectclass=sdcaccountrole)';
    } else if (names.length === 1) {
        filter = '(&(objectclass=sdcaccountrole)(' + options.searchby + '=' +
                    names[0] + '))';
    } else {
        filter = '(&(objectclass=sdcaccountrole)(|(' + options.searchby + '=' +
                    names.join(')(' + options.searchby + '=') + ')))';
    }

    var opts = {
        scope: 'one',
        filter: filter
    };

    var dn = sprintf(USER_FMT, id);
    ufds.search(dn, opts, function (err, groups) {
        if (err || options.searchby !== 'name') {
            return cb(err, groups);
        }

        // If we're loading by name, we're loading it due to role-tags provided
        // by the user, since internally we use UUIDs. In that case, we should
        // check that all the names provided by the user are valid.

        var nameLookup = {};
        names.forEach(function (name) {
            nameLookup[name] = true;
        });

        groups.forEach(function (group) {
            delete nameLookup[group.name];
        });

        var unfoundNames = Object.keys(nameLookup);

        if (unfoundNames.length > 0) {
            var msg = 'Role(s) ' + unfoundNames.join(', ') + ' not found';
            return cb(new restify.InvalidArgumentError(msg));
        }

        return cb(null, groups);
    });
}

module.exports = {
    translateUser: translateUser,
    translateGroup: translateGroup,
    preloadUsers: preloadUsers,
    preloadGroups: preloadGroups
};
