/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * This file defines all the CloudAPI authentication functions,
 * including the following authentication methods:
 *
 * - HTTP Basic Auth (basicAuth): provided just for backwards compatibility
 *   with SDC 6.5 version of CloudAPI. This authentication method is deprecated
 *   for any request with version not being explicitly set to '~6.5'.
 *
 * - HTTP Signature Auth (signatureAuth): both, direct or using token-auth
 *   through 3rd party applications.
 *   Versions 0.9.x and 0.10.x of the http-signature node module are supported.
 *
 * During the authentication process, there are several properties set to the
 * Restify `req` object:
 *
 * - req.caller: Always the sdcPerson object performing the request. It can be
 *   the main account for this request, a sub-user of such account or a
 *   different account, either the same user using a 3rd party application
 *   through token-auth (for example, a web UI), or even an administrative
 *   account performing any action instead of a given user.
 * - req.account: Despite of the value set for `req.caller`, this property will
 *   always be set to the account we're operating as, either if the caller is
 *   the account owner itself, an administrative account or a sub-user.
 * - req.subuser: Only set if the request is being performed by an account
 *   sub-user.
 * - req.username: the login value for `req.caller`, unless on the cases when
 *   a sub-user is performing the request. On such cases, it's set to
 *   `account.login`.
 * - req.subuser: subuser's uuid when present.
 */
var assert = require('assert-plus');
var util = require('util');
// http-signature 0.9.x
var httpSignature = require('./node-http-signature');
// http-signature 0.10.x
var httpSig = require('http-signature');
var restify = require('restify');
var semver = require('semver');
var vasync = require('vasync');

///--- Globals

var BadRequestError = restify.BadRequestError;
var InvalidCredentialsError = restify.InvalidCredentialsError;
var InvalidCreds = restify.InvalidCredentialsError;
var NotAuthorizedError = restify.NotAuthorizedError;
var ResourceNotFoundError = restify.ResourceNotFoundError;



///--- Messages

var DEF_401 = 'You must make authenticated requests to use CloudAPI';
var FORBIDDEN = 'You do not have permission to access %s';
var INVALID_ERR = 'Invalid %s %s';
var INVALID_AUTHZ = 'Invalid authorization header';
var INVALID_KEY = 'Invalid KeyId %s in authorization header';
var INVALID_SIG = 'The signature we calculated does not match the one you sent';
var INVALID_DEV = 'The token provided is not authorized for this application';
var MISSING_CREDS = 'Missing credentials';
var SCHEME_NOT_SUPPORTED = 'The authorization scheme you requested is ' +
    'not supported';
var USER_404 = 'User %s does not exist';



///--- Middleware

function basicAuth(req, res, next) {
    assert.ok(req.log);
    assert.ok(req.sdc);

    var scheme = req.authorization.scheme || '';
    if (scheme.toLowerCase() !== 'basic') {
        return next();
    }

    // basic auth is deprecated on 7.0+
    if (! /6\.5/.test(req.getVersion())) {
        return next(new InvalidCredentialsError(SCHEME_NOT_SUPPORTED));
    }

    var log = req.log;
    var ufds = req.sdc.ufds;

    var user = req.authorization.basic.username;
    var pass = req.authorization.basic.password;
    if (!user || !pass) {
        return next(new InvalidCredentialsError(MISSING_CREDS));
    }


    log.debug('basicAuth: authorization=%j', req.authorization);
    return ufds.authenticate(user, pass, function (err, customer) {
        if (err) {
            log.error({err: err}, 'UFDS.authenticate error');
            if (err.statusCode === 404) {
                return next(new InvalidCredentialsError(USER_404, user));
            }
            return next(new InvalidCredentialsError(DEF_401));
        }
        return ufds.getMetadata(customer, 'cloudapi',
                    function (mderr, metadata) {
            if (mderr || metadata === null ||
                    metadata.require_http_signature !== 'true') {
                req.caller = customer;
                req.username = req.caller.login;
                return next();
            } else {
                return next(new InvalidCredentialsError(SCHEME_NOT_SUPPORTED));
            }
        });
    });
}


function signatureAuth(req, res, next) {
    assert.ok(req.log);
    assert.ok(req.sdc);

    var scheme = req.authorization.scheme || '';
    if (scheme.toLowerCase() !== 'signature') {
        return next();
    }

    var keyId;
    var log = req.log;
    var sig = req.authorization.signature;
    var ufds = req.sdc.ufds;

    try {
        keyId = sig.keyId.split('/');
    } catch (e) {
        log.error('Error parsing authorization header: %s', e.stack);
        return next(new BadRequestError(INVALID_AUTHZ));
    }

    // keyId.length is 4 for main account users and 6 for sub-users,
    // given we do need to identify both, main account, and that the sub-user
    // key may have the same name than the main account key.
    // We'll take advantage of this to difference between main account user
    // and sub-users here
    var v = req.getVersion();
    var account, key, subuser;
    var login, keyID, sublogin;

    if (!keyId || keyId.length !== 4 || keyId[2] !== 'keys') {
        // Sub-users login starting with version 7.2.0:
        if (!(semver.satisfies('7.2.0', v) || semver.ltr('7.2.0', v))) {
            return next(new InvalidCreds(INVALID_KEY, sig.keyId));
        } else {
            if (!keyId || keyId.length !== 6 || keyId[4] !== 'keys') {
                return next(new InvalidCreds(INVALID_KEY, sig.keyId));
            } else {
                sublogin = keyId[3];
                keyID = keyId[5];
            }
        }
    } else {
        keyID = keyId[3];
    }

    login = keyId[1];

    function getAccount(_, cb) {
        ufds.getUser(login, function (err, u) {
            if (err) {
                log.trace({err: err}, 'UFDS.getUser error');
                return cb(new InvalidCreds(INVALID_ERR, 'account', login));
            }
            account = u;
            return cb(null);
        });
    }

    function getKey(_, cb) {
        var a = (subuser) ? account.uuid : null;
        var u = (subuser) ? subuser : account;
        ufds.getKey(u, keyID, a, function (err, k) {
            if (err) {
                log.trace({err: err}, 'UFDS.getKey error');
                return cb(new InvalidCreds(INVALID_ERR, 'key', keyID));
            }
            key = k;
            return cb(null);
        });
    }

    function getSubUser(_, cb) {
        ufds.getUser(sublogin, account.uuid, function (err, u) {
            if (err) {
                log.trace({err: err}, 'UFDS.getUser error');
                return cb(new InvalidCreds(INVALID_ERR, 'account', sublogin));
            }
            subuser = u;
            return cb(null);
        });
    }

    function verifySignature(_, cb) {
        log.debug('authSig using key %s => %s', sig.keyId, key.pkcs);
        var signatureVerified = false;

        try {
            // Attempt using http-signature 0.9.x first
            signatureVerified =
                httpSignature.verifySignature(sig, key.pkcs);
        } catch (e) {
            // On execption, attempt using http-signature 0.10.x:
            try {
                signatureVerified = httpSig.verifySignature(sig, key.pkcs);
            } catch (e2) {
                log.error('Error calling http_signature: ' + e.stack);
                return cb(new InvalidCreds(INVALID_SIG));
            }
        }

        if (!signatureVerified) {
            log.debug('authSig::verify FAIL: %j, key=%s',
                            sig, key.standard);
            return cb(new InvalidCreds(INVALID_SIG));
        }
        return cb(null);
    }

    var funcs = [getAccount];

    if (sublogin) {
        funcs.push(getSubUser);
    }

    return vasync.pipeline({
        funcs: funcs.concat([getKey, verifySignature])
    }, function (err, results) {
        if (err) {
            return next(err);
        }

        req.caller = (subuser) ? subuser : account;
        if (subuser) {
            req.subuser = subuser.uuid;
            req.account = account;
        }
        req.username = account.login;
        return next();
    });
}


function tokenAuth(req, res, next) {
    assert.ok(req.log);
    assert.ok(req.sdc);

    var scheme = req.authorization.scheme || '';
    if (scheme.toLowerCase() !== 'signature') {
        return next();
    }

    var log = req.log;
    var sig = req.authorization.signature;

    if (!req.header('X-Auth-Token')) {
        return next();
    }

    try {
        var token = JSON.parse(req.header('X-Auth-Token'));
        return req.sdc.keyapi.detoken(token,
                function (clienterr, clientobj) {
                if (clienterr) {
                    log.error({err: clienterr}, 'keyapi error');
                    return next(new InvalidCredentialsError(
                        INVALID_DEV));
                }
                if (clientobj.expires) {
                    var expires = new Date(clientobj.expires);
                    var now = new Date();
                    if (now > expires) {
                        return next(new InvalidCredentialsError(
                        INVALID_DEV));
                    }
                }
                if (clientobj.devkeyId !== sig.keyId) {
                    return next(new InvalidCredentialsError(
                            INVALID_DEV));
                }
                if (!clientobj.permissions.cloudapi) {
                    return next(new InvalidCredentialsError(
                            INVALID_DEV));
                }
                var perms = clientobj.permissions.cloudapi;
                var authorized = false;
                var i;
                for (i = 0; i < perms.length; i += 1) {
                    var currperm = perms[i].split('/*');
                    if (currperm[0] === req.url) {
                        authorized = true;
                        break;
                    }
                    if (req.url.search(currperm[0]) === 0) {
                        if (currperm.length === 2 &&
                            req.url.charAt(currperm[0].length) ===
                            '/') {
                            authorized = true;
                            break;
                        }
                    }
                }

                if (authorized === true) {
                    req.caller = clientobj.account;
                    req.username = clientobj.account.login;
                    return next();
                } else {
                    return next(new InvalidCredentialsError(
                        INVALID_DEV));
                }
            });
    } catch (e) {
        log.error('Error calling keyapi: ' + e.stack);
        return next(new InvalidCredentialsError(INVALID_SIG));
    }

}


function assertAuthenticated(req, res, next) {
    if (req.url === '/--ping') {
        return next();
    }

    if (typeof (req.caller) !== 'object') {
        return next(new InvalidCredentialsError(DEF_401));
    }

    return next();
}


function loadAccount(req, res, next) {
    if (req.url === '/--ping') {
        return next();
    }

    assert.ok(req.sdc);

    var log = req.log;
    var ufds = req.sdc.ufds;

    if (req.params.account === 'my') {
        req.params.account = req.caller.login;
    }
    req.params.account = decodeURIComponent(req.params.account);

    if (req.subuser) {
        // Account already set during signature auth, no need to re-do:
        log.debug('account %j already loaded', req.account);
        return next();
    }

    // PUBAPI-780: If request is made by the user itself, using no token-auth
    // we can safely skip account re-loading.
    if (req.username === req.params.account && !req.header('X-Auth-Token')) {
        log.debug('account %j already loaded', req.caller);
        req.account = req.caller;
        return next();
    }

    return ufds.getUser(req.params.account, function (err, customer) {
        if (err) {
            log.error({err: err}, 'UFDS.getUser error');
            return next(err);
        }

        log.debug('loaded account %j', customer);
        req.account = customer;
        return next();
    });
}


// PUBAPI-834: sdcAccountRole/policy authorization for sdcAccountUsers
// takes place here.
function authorize(req, res, next) {
    if (req.url === '/--ping') {
        return next();
    }

    assert.ok(req.account);
    assert.ok(req.caller);

    var account = req.account;
    var caller = req.caller;

    if ((account.uuid !== caller.uuid) && !caller.isAdmin()) {
        if (req.subuser && req.accountMgmt) {
            return req.caller.defaultRoles(function (err, activeRoles) {
                if (err) {
                    return next(
                        new NotAuthorizedError(FORBIDDEN, account.login));
                }
                return req.sdc.mahi.getUser(req.caller.login,
                        req.account.login, function (err2, info) {

                    if (err2) {
                        return next(
                            new NotAuthorizedError(FORBIDDEN, account.login));
                    }

                    var authOpts = {
                        typeTable: req.config.apertureConfig.typeTable,
                        principal: info,
                        action: req.method.toLowerCase(),
                        resource: {
                            key: req.path()
                        },
                        conditions: {
                            route: req.routename,
                            method: req.method.toLowerCase(),
                            activeRoles: activeRoles.map(function (r) {
                                return (r.uuid);
                            })
                        }
                    };

                    if (req.resource.roles && req.resource.roles.length) {
                        authOpts.resource.roles =
                            req.resource.roles.map(function (r) {
                            return (r.uuid);
                        });
                    } else {
                        authOpts.resource.roles = [];
                    }


                    return req.sdc.mahi.getAccount(req.account.login,
                            function (er, owner) {
                        if (er) {
                            return next(
                                new NotAuthorizedError(FORBIDDEN,
                                    account.login));
                        }

                        authOpts.resource.owner = owner;

                        var authorized;
                        try {
                            authorized = req.sdc.mahi.authorize(authOpts);
                        } catch (e) {
                            return next(
                                new NotAuthorizedError(FORBIDDEN,
                                    account.login));
                        }
                        // In theory mahi should raise an exception if the user
                        // is not authorized. Just in case:
                        if (!authorized) {
                            return next(
                                new NotAuthorizedError(FORBIDDEN,
                                    account.login));
                        }
                        // We may need this for later use if we are creating
                        // new resources and the sub-user didn't specify any
                        // role.tag:
                        req.activeRoles = activeRoles;
                        return next();
                    });
                });
            });
        } else {
            return next(new NotAuthorizedError(FORBIDDEN, account.login));
        }
    } else {
        return next();
    }
}


///--- Exports

module.exports = {
    basicAuth: basicAuth,
    signatureAuth: signatureAuth,
    tokenAuth: tokenAuth,
    assertAuthenticated: assertAuthenticated,
    loadAccount: loadAccount,
    authorize: authorize
};
