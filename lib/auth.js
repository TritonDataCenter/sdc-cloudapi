/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/* BEGIN JSSTYLED */
/*
 * CloudAPI authentication (authn) and authorization (authz) restify handlers.
 *
 * Usage:
 *      // Parse the "Authorization" header.
 *      server.use(authorization.authorizationParser);
 *
 *      // Handle authn. Try each authentication method, and then assert
 *      // we authenticated.
 *      server.use(auth.authnSignature);
 *      server.use(auth.authnToken);
 *      server.use(auth.authnAssert);
 *
 *      // Load `req.account` for the '/:account/...' request URL.
 *      // This also sets `req.rbacUser` if appropriate.
 *      server.use(auth.authzAccount);
 *
 *      // Run any optional authz handlers.
 *      if (config.account_allowed_dcs) {
 *          server.use(auth.authzAllowedDcs);
 *      }
 *
 *      // Later do RBAC authz handling.
 *      // ... a few RBAC "resource"-related handlers.
 *      server.use(auth.authzRbac);
 *
 *
 * CloudAPI supports two authentication methods: http-signature and token auth.
 *
 * Wrinkles:
 * - RBAC support (added in API version 7.2) means either a top-level
 *   *account* or an *RBAC user* is relevant.
 * - For backward compatibility, http-signature v0.9 is still supported.
 *   See PUBAPI-1177 for eventually dropping support for this. As of Nov 2015
 *   portal still uses 0.9 form "Authorization" headers and node-smartdc only
 *   recently updated.
 *
 *
 * # added `req` fields
 *
 * - `req.authAccount` is the account object that made the call.
 *   This is always the one in the "Authorization" header. So, for example, if
 *   token auth is being used by `portalaccount` to call on behalf of
 *   `acmecorp`, the authAccount is *portalaccount*.
 * - `req.authRbacUser`, if applicable, is the RBAC user object that made
 *   the call (i.e. from the Authorization header).
 * - `req.authToken`, if token auth is used, is the decrypted auth token.
 *
 * - `req.account` is the account object corresponding to the request path.
 *   E.g. for "GET /acmecorp/machines", `req.account` will be the account
 *   object for acmecorp. If the special case "/my" shortcut is used, then it
 *   will be the *account* from authentication: `req.authAccount`.
 * - `req.rbacUser`, if applicable, is the RBAC user object that is relevant
 *   for the request. Because token auth allows delegation, this is distinct
 *   from `req.authRbacUser`. See examples below.
 *
 * The main one is `req.account`. That is what most of the cloudapi endpoints
 * use. The others are typically only used by auth* and rbac* handlers.
 *
 *
 * # error responses from handlers
 *
 * Errors in auth can result in the following errors:
 *      BadRequestError
 *      InternalError
 *      InvalidCredentialsError
 *      InvalidCreds
 *      NotAuthorizedError
 */
/* END JSSTYLED */

var assert = require('assert-plus');
var util = require('util');
// obsolete http-signature 0.9.x
var httpSig09 = require('./node-http-signature');
// Modern http-signature
var httpSig = require('http-signature');
var restify = require('restify');
var semver = require('semver');
var vasync = require('vasync');


// ---- Globals

var BadRequestError = restify.BadRequestError;
var InternalError = restify.InternalError;
var InvalidArgumentError = restify.InvalidArgumentError;
var InvalidCredentialsError = restify.InvalidCredentialsError;
var NotAuthorizedError = restify.NotAuthorizedError;

var SIGN_ALGOS = {
    'RSA-SHA1': true,
    'RSA-SHA256': true,
    'RSA-SHA384': true,
    'RSA-SHA512': true,
    'DSA-SHA1': true,
    'DSA-SHA256': true,
    'ECDSA-SHA256': true,
    'ECDSA-SHA384': true,
    'ECDSA-SHA512': true
};

// Error messages
var ACCOUNT_DISABLED = 'Account %s is disabled';
var BACKEND_ERR = 'Unexpected error fetching account';
var DEF_401 = 'You must make authenticated requests to use CloudAPI';
var FORBIDDEN = 'You do not have permission to access %s';
var INVALID_ERR = 'Invalid %s %s';
var INVALID_AUTHZ = 'Invalid authorization header';
var INVALID_KEY = 'Invalid keyId %s in authorization header';
var INVALID_SIG = 'The signature we calculated does not match the one you sent';
var INVALID_ALGO = '%s is not a supported signing algorithm';
var INVALID_DEV = 'The token provided is not authorized for this application';
var SCHEME_NOT_SUPPORTED = 'The authorization scheme you requested is ' +
    'not supported';
var USER_404 = 'User %s does not exist';
var FEATURE_NOT_ENABLED = 'RBAC feature is not enabled';



// ---- Middleware

/* BEGIN JSSTYLED */
/*
 * HTTP Signature authentication.
 *
 * A basic request to cloudapi uses just http-signature auth. This means an
 * "Authorization" header using the "Signature" scheme. Examples:
 *
 * - A request by account "acmecorp" using an SSH key with fingerprint
 *   "c0:f6:93:76:1e:5d:72:43:cc:67:9a:71:97:1d:d6:cc":
 *          Authorization: Signature keyId="/acmecorp/keys/c0:f6:93:76:1e:5d:72:43:cc:67:9a:71:97:1d:d6:cc",algorithm="RSA-SHA256",signature="<signature>"
 *   To authenticate as "acmecorp", SDC must have a public key for the acmecorp
 *   account with the given fingerprint. Then then pubkey and the opaque
 *   `<signature>` are passed to the "http-signature" module for verification.
 *
 * - A request by account "acmecorp" RBAC user "bob", using one of Bob's keys:
 *          Authorization: Signature keyId="/acmecorp/users/bob/keys/34:3a:7e:b9:7b:2e:d9:40:6c:27:d7:75:01:49:7b:77",algorithm="RSA-SHA256",signature="<signature>"
 *                                                   ^^^^^^^^^^
 *   That underlined part is what tells us this is an RBAC user making the
 *   request.
 */
/* END JSSTYLED */
function authnSignature(req, res, next) {
    assert.object(req.authorization, 'req.authorization');
    var scheme = req.authorization.scheme || '';
    if (scheme.toLowerCase() !== 'signature') {
        next();
        return;
    }

    var log = req.log;
    var ufds = req.sdc.ufds;
    var sig = req.authorization.signature;
    var algorithm = req.authorization.signature.algorithm;

    if (SIGN_ALGOS[algorithm] !== true) {
        return next(new InvalidCredentialsError(INVALID_ALGO, algorithm));
    }

    var keyIdParts;
    try {
        keyIdParts = sig.keyId.split('/');
    } catch (e) {
        log.error('Error parsing authorization header: %s', e.stack);
        return next(new BadRequestError(INVALID_AUTHZ));
    }

    /*
     * A keyId example for vanilla top-level account auth:
     *      /acmecorp/keys/c0:f6:93:76:1e:5d:72:43:cc:67:9a:71:97:1d:d6:cc
     * and for a sub-user (aka an RBAC user):
     *      /acmecorp/users/bob/keys/34:3a:7e:b9:7b:2e:d9:40:6c:27:d...
     *
     * keyIdParts.length is 4 for main account users and 6 for sub-users.
     *
     * Dev Note: I'd prefer this have must stricter validation. However there
     * are some cases in the wild where "/:account/user/..." (singular) is
     * used instead of "/:account/users/...". To go strict we'd need to ID
     * those cases and phase them out.
     */
    var v = req.getVersion();
    var login, keyFingerprint, sublogin;
    if (!keyIdParts || keyIdParts.length !== 4 || keyIdParts[2] !== 'keys') {
        // Sub-users login starting with version 7.2.0:
        if (!(semver.satisfies('7.2.0', v) || semver.ltr('7.2.0', v))) {
            next(new InvalidCredentialsError(INVALID_KEY, sig.keyId));
            return;
        } else {
            if (!keyIdParts || keyIdParts.length !== 6 ||
                keyIdParts[4] !== 'keys')
            {
                return next(new InvalidCredentialsError(
                    INVALID_KEY, sig.keyId));
            } else {
                sublogin = keyIdParts[3];
                keyFingerprint = keyIdParts[5];
            }
        }
    } else {
        keyFingerprint = keyIdParts[3];
    }
    login = keyIdParts[1];


    var authAccount, key, authRbacUser;

    var funcs = [getAccount, ensureAccountEnabled];
    if (sublogin) {
        funcs.push(getRbacUser);
    }
    funcs.push(getKey, verifySignature);

    return vasync.pipeline({funcs: funcs}, function (err, results) {
        if (err) {
            next(err);
            return;
        }

        req.authAccount = authAccount;
        req.authRbacUser = authRbacUser;
        next();
    });


    function getAccount(_, cb) {
        ufds.getUser(login, function (err, ufdsUser) {
            if (err) {
                if (err.restCode === 'ResourceNotFound') {
                    log.info('UFDS.getUser found no account');
                } else if (err.restCode === 'InternalError') {
                    // separate out InternalError so that we don't incorrectly
                    // report a user doesn't exist if there's a problem
                    // reaching the backend
                    log.trace({err: err}, 'UFDS.getUser error');
                    return cb(new InternalError(BACKEND_ERR));
                } else {
                    log.trace({err: err}, 'UFDS.getUser error');
                }
                cb(new InvalidCredentialsError(
                    INVALID_ERR, 'account', login));
                return;
            }

            authAccount = ufdsUser;
            cb();
        });
    }

    function ensureAccountEnabled(_, cb) {
        if (authAccount.disabled === 'true') {
            cb(new NotAuthorizedError(ACCOUNT_DISABLED, login));
        } else {
            cb();
        }
    }

    function getRbacUser(_, cb) {
        // XXX(trent) does getUser by user *login* actually work?
        ufds.getUser(sublogin, authAccount.uuid, function (err, u) {
            if (err) {
                if (err.restCode === 'ResourceNotFound') {
                    log.info('UFDS.getUser found no subuser');
                } else {
                    log.trace({err: err}, 'UFDS.getUser error');
                }
                cb(new InvalidCredentialsError(
                    INVALID_ERR, 'account ' + login + ' user', sublogin));
                return;
            }
            authRbacUser = u;
            cb();
        });
    }

    function getKey(_, cb) {
        var a = (authRbacUser) ? authAccount.uuid : null;
        var u = (authRbacUser) ? authRbacUser : authAccount;
        ufds.getKey(u, keyFingerprint, a, function (err, k) {
            if (err) {
                log.trace(err, 'UFDS.getKey error');
                return cb(new InvalidCredentialsError(
                    INVALID_ERR, 'key', keyFingerprint));
            }
            key = k;
            cb();
        });
    }

    function verifySignature(_, cb) {
        log.debug({keyId: sig.keyId, pkcs: key.pkcs}, 'verifySignature');
        var signatureVerified = false;

        try {
            if (sig.is09) {
                signatureVerified = httpSig09.verifySignature(sig, key.pkcs);
            } else {
                signatureVerified = httpSig.verifySignature(sig, key.pkcs);
            }
        } catch (err) {
            log.error({err: err}, 'verifySignature: exception');
            return cb(new InvalidCredentialsError(INVALID_SIG));
        }

        if (!signatureVerified) {
            log.debug({sig: sig, key: key.standard}, 'verifySignature: FAIL');
            return cb(new InvalidCredentialsError(INVALID_SIG));
        }
        return cb(null);
    }
}


/* BEGIN JSSTYLED */
/**
 * Token authentication
 *
 * Token auth is for delegated auth. It is, for example, what the user portal
 * uses to make cloudapi requests on behalf of the user logged into the portal.
 * RBAC is potentially in play too.
 *
 * A request using token auth is identified by the presence of the
 * 'X-Auth-Token' header. Token auth requests still use HTTP Signature auth to
 * authenticate the actual caller (e.g. the portal).
 *
 * Examples:
 *
 * - The account "portalaccount" is making a request on behalf of someone:
 *          authorization: Signature keyId="/portalaccount/keys/10:33:09:05:02:fb:68:4d:1d:f5:ef:8f:c2:e7:dd:b8",algorithm="RSA-SHA256",signature="Qru...9Lg=="
 *          x-auth-token: {"keyid":"d8f12a97-9aab-45b8-98c8-005e293c222b","data":"GvC...dg==","version":"0.1.0","hash":"s7...fU="}
 *   First http-signature authenticates the 'portalaccount'. Then the
 *   auth token is verified and decrypted (by the "keyapi" library) to give:
 *          { account:
 *             { dn: 'uuid=81d4e1d4-9495-11e5-946f-1359047d9e60, ou=users, o=smartdc',
 *               cn: 'Acme Corp',
 *               login: 'acmecorp',
 *               objectclass: 'sdcperson',
 *               ...
 *               uuid: '81d4e1d4-9495-11e5-946f-1359047d9e60' },
 *            devkeyId: '/portalaccount/keys/10:33:09:05:02:fb:68:4d:1d:f5:ef:8f:c2:e7:dd:b8',
 *            permissions: { cloudapi: [ '/my/*' ] },
 *            expires: '2015-11-27T21:15:35.028Z' }
 *   Now we see that the request is being made on behalf of account "acmecorp",
 *   requesting permission (the `permissions` field) to all endpoints under
 *   `/my/*` on `cloudapi`.
 *
 * - The account "portalaccount" making a request on behalf of someone. This
 *   time it is an RBAC user, but we don't know that until the auth token
 *   is decrypted:
 *          { account:
 *             { dn: 'uuid=81d4e1d4-9495-11e5-946f-1359047d9e60, ou=users, o=smartdc',
 *               cn: 'Acme Corp',
 *               login: 'acmecorp',
 *               objectclass: 'sdcperson',
 *               ...
 *               uuid: '81d4e1d4-9495-11e5-946f-1359047d9e60' },
 *            subuser:
 *             { dn: 'uuid=9037a8a8-9498-11e5-8379-274782d6cbd3, ou=users, o=smartdc',
 *               cn: 'Bob Smith',
 *               login: 'bob',
 *               objectclass: 'sdcperson',
 *               ...
 *               account: '81d4e1d4-9495-11e5-946f-1359047d9e60',
 *               uuid: '9037a8a8-9498-11e5-8379-274782d6cbd3' },
 *            devkeyId: '/portalaccount/keys/10:33:09:05:02:fb:68:4d:1d:f5:ef:8f:c2:e7:dd:b8',
 *            permissions: { cloudapi: [ '/my/*' ] },
 *            expires: '2015-11-27T21:15:35.028Z' }
 *   We now see the request is on behalf of account "acmecorp" RBAC user "bob".
 *
 * In practice the auth tokens, e.g. `{"keyid":"d8f...}`, are issued by
 * a separate service (internally at JPC, 'sdcsso'). Note also that while
 * Joyent uses token auth, it is not recommended for general use.
 *
 *
 * @field req.authToken {Object} The decrypted auth token, on success.
 */
/* END JSSTYLED */
function authnToken(req, res, next) {
    assert.object(req.authorization, 'req.authorization');

    var authTokenHeader = req.header('X-Auth-Token');
    if (!authTokenHeader) {
        next();
        return;
    }

    // We already require that a previous authn method set `req.authAccount`.
    // That means http-signature auth, above.
    if (! req.authAccount) {
        next(new InvalidCredentialsError(DEF_401));
        return;
    }

    var log = req.log;

    function handleToken(err, authToken) {
        if (err) {
            log.error(err, 'keyapi token error');
            next(new InvalidCredentialsError(INVALID_DEV));
            return;
        }

        if (authToken.expires) {
            var expires = new Date(authToken.expires);
            var now = new Date();
            if (now > expires) {
                log.debug({expires: expires, now: now},
                    'authnToken: token expired');
                next(new InvalidCredentialsError(INVALID_DEV));
                return;
            }
        }

        if (authToken.devkeyId !== req.authorization.signature.keyId) {
            log.debug({devkeyId: devkeyId,
                keyId: req.authorization.signature.keyId},
                'authnToken: devkeyId mismatch');
            next(new InvalidCredentialsError(INVALID_DEV));
            return;
        }

        if (!authToken.permissions.cloudapi) {
            log.debug({permissions: permissions},
                'authnToken: permissions not for cloudapi');
            next(new InvalidCredentialsError(INVALID_DEV));
            return;
        }

        /*
         * Per sdcsso docs, the permissions object is an array of strings
         * that represent URLs that may be accessed, with simple globbing.
         * E.g. the common one is:
         *      permissions.cloudapi = ['/my/*']
         *
         * The current implementation is a pretty brittle one.
         */
        var authorized = false;
        var perms = authToken.permissions.cloudapi;
        var pathname = req.getUrl().pathname;
        for (var i = 0; i < perms.length; i++) {
            var currPerm = perms[i].split('/*');
            var currPermUrl = currPerm[0];

            if (currPermUrl === pathname) {
                authorized = true;
                break;
            }

            if (pathname.search(currPermUrl) === 0 &&
                currPerm.length === 2 &&
                pathname.charAt(currPermUrl.length) === '/')
            {
                authorized = true;
                break;
            }
        }
        if (!authorized) {
            log.debug({permissions: permissions, pathname: pathname},
                'authnToken: permissions do not authorize request path');
            next(new InvalidCredentialsError(INVALID_DEV));
            return;
        }

        req.authToken = authToken;
        next();
    }

    try {
        var token = JSON.parse(authTokenHeader);
        req.sdc.keyapi.detoken(token, handleToken);
    } catch (tokenErr) {
        log.error(tokenErr, 'authnToken: keyapi token exception');
        next(new InvalidCredentialsError(INVALID_SIG));
    }
}


function authnAssert(req, res, next) {
    // XXX clean out ping guards
    if (req.getUrl().pathname === '/--ping') {
        return next();
    }

    if (typeof (req.authAccount) !== 'object') {
        // TODO: WWW-Authenticate header would be nice here.
        return next(new InvalidCredentialsError(DEF_401));
    }

    return next();
}



/*
 * 1. Load `req.account`, the account object for the request path
 *    '/:account/...'
 * 2. Ensure that the authenticated user may access it.
 * 3. Also set `req.rbacUser` to the object, if applicable.
 */
function authzAccount(req, res, next) {
    // XXX clean out ping guards
    if (req.getUrl().pathname === '/--ping') {
        return next();
    }

    assert.string(req.params.account, 'req.params.account');
    assert.object(req.authAccount, 'req.authAccount');
    assert.func(req.authAccount.isAdmin, 'req.authAccount.isAdmin');
    assert.optionalObject(req.authToken, 'req.authToken');
    if (req.authToken) {
        assert.string(req.authToken.account.login,
            'req.authToken.account.login');
    }
    var log = req.log;

    // Determine the relevant account login. Ensure access to it.
    var login;
    var accountParam = decodeURIComponent(req.params.account);
    if (accountParam === 'my') {
        if (req.authToken) {
            login = req.authToken.account.login;
        } else {
            login = req.authAccount.login;
        }
        log.trace('authzAccount: /my -> /%s', login);
    } else {
        /*
         * Ensure that an authToken for account `acmecorp` can't access, e.g.,
         * "GET /roadrunnercorp/machines".
         */
        if (req.authToken) {
            if (accountParam !== req.authToken.account.login) {
                next(new NotAuthorizedError(FORBIDDEN, '/' + accountParam));
                return;
            }
        }

        /*
         * For vanilla signature auth (i.e. not token auth), we *do* allow
         * an account to access another's resources iff:
         * - `authAccount` is a member of the operators group; and
         * - we didn't auth as an RBAC user
         */
        else {
            if (accountParam !== req.authAccount.login &&
                (req.authRbacUser || !req.authAccount.isAdmin()))
            {
                next(new NotAuthorizedError(FORBIDDEN, '/' + accountParam));
                return;
            }
        }

        login = accountParam;
    }

    /*
     * Now set `req.account` and `req.rbacUser`, loading them if necessary.
     *
     * In some cases, we've already loaded the account object, so we can
     * abort early.
     *
     * Note: Currently we *don't* use the account object from token auth,
     * reloading it instead. However, I don't know if that is because of
     * (a) a real reason (don't trust it, or tokens have a session time so it
     *     might be out of date); or
     * (b) because cloudapi code paths require `req.account` to be a
     *     "User" object loaded from node-ufds with silly bells a whistles
     *     like `<user>.isAdmin()`, `<user>.roles()`, etc.
     */
    if (!req.authToken) {
        if (req.authRbacUser) {
            req.rbacUser = req.authRbacUser;
        }

        if (req.authAccount.login === login) {
            req.account = req.authAccount;
            next();
            return;
        }
    }

    /*
     * We need to load the account object, and possibly the RBAC user object.
     */
    vasync.parallel({funcs: [
        function fetchAccount(next2) {
            req.sdc.ufds.getUser(login, function (err, ufdsUser) {
                if (err) {
                    log.error({err: err, login: login},
                        'authzAccount: UFDS.getUser error');
                    next(err);
                    return;
                }

                if (ufdsUser.disabled === 'true') {
                    next2(new NotAuthorizedError(ACCOUNT_DISABLED, login));
                    return;
                }

                req.account = ufdsUser;
                next2();
            });
        },

        function fetchRbacUser(next2) {
            if (req.rbacUser || !req.authToken || !req.authToken.subuser) {
                next2();
                return;
            }
            var subuser = req.authToken.subuser;
            req.sdc.ufds.getUser(subuser.uuid, subuser.account,
                    function (err, ufdsUser) {
                if (err) {
                    log.error({err: err, rbacUserUuid: subuser.uuid,
                        rbacUserAccount: subuser.account},
                        'authzAccount: UFDS.getUser error');
                    next(err);
                    return;
                }
                req.rbacUser = ufdsUser;
                next2();
            });
        }
    ]}, function (err) {
        next(err);
    });
}


/**
 * Deny access if the account.allowed_dcs doesn't include this DC.
 * This middleware is only added if `config.account_allowed_dcs` is true.
 */
function authzAllowedDcs(req, res, next) {
    if (req.getUrl().pathname === '/--ping') {
        next();
        return;
    }

    var datacenterName = req.config.datacenter_name;
    var allowed_dcs = req.account.allowed_dcs;
    if (!allowed_dcs ||
        (Array.isArray(allowed_dcs)
            ? allowed_dcs.indexOf(datacenterName) === -1
            : allowed_dcs !== datacenterName))
    {
        var forbiddenMsg = 'Forbidden';
        if (req.config.account_allowed_dcs_msg) {
            forbiddenMsg += ' (' + req.config.account_allowed_dcs_msg + ')';
        }
        next(new NotAuthorizedError(forbiddenMsg));
        return;
    }

    next();
}


/*
 * RBAC authorization (aka PUBAPI-834, sdcAccountRole, policy authorization for
 * sdcAccountUsers).
 */
function authzRbac(req, res, next) {
    if (req.getUrl().pathname === '/--ping') {
        return next();
    }

    if (!req.rbacUser) {
        next();
        return;
    } else if (!req.rbacFeatureEnabled) {
        next(new NotAuthorizedError(FEATURE_NOT_ENABLED));
        return;

    }

    assert.object(req.account, 'req.account');
    assert.object(req.rbacUser, 'req.rbacUser');
    assert.object(req.sdc.mahi, 'req.sdc.mahi');
    var mahi = req.sdc.mahi;
    var log = req.log;

    var op = vasync.pipeline({arg: {}, funcs: [

        /*
         * Active roles are either:
         * 1. Those named in the 'as-role' query param, and sanity checked that
         *    they are in the user's set of roles; else
         * 2. The user's set of default roles.
         */
        function getActiveRoles1(ctx, next2) {
            var asRoleParam = (req.params['as-role'] || '').trim();
            ctx.reqRoleNames = asRoleParam.split(',')
                .map(function (r) { return r.trim(); })
                .filter(function (r) { return r; });

            if (!ctx.reqRoleNames.length) {
                next2();
                return;
            }

            req.rbacUser.roles(function (err, roles) {
                if (err) {
                    log.error({err: err, rbacUser: req.rbacUser},
                        'error getting RBAC user roles');
                    // XXX test this, does it take a cause?
                    next2(new NotAuthorizedError(
                        err, FORBIDDEN, '/' + req.account.login));
                    return;
                }

                var roleFromName = {};
                roles.forEach(function (r) { roleFromName[r.name] = r; });

                missing = [];
                activeRoles = [];
                for (var i = 0; i < ctx.reqRoleNames.length; i++) {
                    var name = ctx.reqRoleNames[i];
                    var role = roleFromName[name];
                    if (role) {
                        activeRoles.push(role);
                    } else {
                        missing.push(name);
                    }
                }
                if (missing.length) {
                    next2(new InvalidArgumentError(format(
                        'invalid "as-role" param: user %s does not have the ' +
                        'following roles: %s',
                        req.rbacUser.login, missing.join(', '))));
                    return;
                }

                ctx.activeRoles = activeRoles;
                next2();
            });
        },
        function getActiveRoles2(ctx, next2) {
            if (ctx.reqRoleNames.length) {
                next2();
                return;
            }
            req.rbacUser.defaultRoles(function (err, defaultRoles) {
                if (err) {
                    log.error({err: err, rbacUser: req.rbacUser},
                        'error getting RBAC user default roles');
                    // XXX test this, does it take a cause?
                    next2(new NotAuthorizedError(
                        err, FORBIDDEN, '/' + req.account.login));
                    return;
                }
                ctx.activeRoles = defaultRoles;
                next2();
            });
        },

        function getMahiAccount(ctx, next2) {
            mahi.getAccount(req.account.login, function (err, mahiAccount) {
                if (err) {
                    log.error({err: err, login: req.account.login},
                        'error getting mahi account');
                    // XXX test this, does it take a cause?
                    next2(new NotAuthorizedError(
                        err, FORBIDDEN, '/' + req.account.login));
                    return;
                }
                ctx.mahiAccount = mahiAccount;
                next2();
            });
        },

        // TODO: We'd already have this if we just switched to mahi instead of
        //      direct UFDS.
        function getMahiUser(ctx, next2) {
            mahi.getUser(req.rbacUser.login, req.account.login,
                    function (err, mahiUser) {
                if (err) {
                    log.error({err: err, rbacUser: req.rbacUser},
                        'error getting mahi user');
                    // XXX test this, does it take a cause?
                    next2(new NotAuthorizedError(
                        err, FORBIDDEN, '/' + req.account.login));
                    return;
                }
                ctx.mahiUser = mahiUser;
                next2();
            });
        },

        function mahiAuthorize(ctx, next2) {
            var authzOpts = {
                principal: ctx.mahiUser,
                action: req.routename, // XXX rename
                resource: {
                    key: req.path(),
                    // XXX node-mahi suggests this could be the mahi *user*
                    //     for some cases. When should that be the case here?
                    //     How about for a user's own /my/users/$login ?
                    //     Hrm, this changes nothing. node-mahi uses only
                    //     `owner.account.*`.
                    //owner: ctx.mahiAccount
                    owner: ctx.mahiUser
                },
                conditions: {
                    date: new Date(req._time),
                    day: new Date(req._time),
                    time: new Date(req._time),
                    'user-agent': req.headers['user-agent'],
                    sourceip: req.connection._xff,
                    method: req.method.toLowerCase(),
                    // TODO: Really want active role *UUIDs* here?
                    activeRoles: ctx.activeRoles.map(function (r) { return (r.uuid); })
                }
            };

            // PENDING: Need to review if we can go ahead with just a single IP
            // argument or may need to difference between IPs by nic tag (private,
            // public, ...).
            if (req.machine && req.machine.ips) {
                authzOpts.conditions.ip = req.machine.ips;
            }

            // It is important to document that in order to use tags in policy
            // rules, the "::string" type name must be appended to the tag name:
            // `tag_$tagName::string=$tagValue`:
            if (req.machine && req.machine.tags) {
                var tags = req.machine.tags;

                Object.keys(tags).forEach(function (t) {
                    authzOpts.conditions['tag_' + t] = tags[t];
                });
            }

            if (req.resource.roles && req.resource.roles.length) {
                authzOpts.resource.roles = req.resource.roles.map(function (r) {
                    return (r.uuid);
                });
            } else {
                authzOpts.resource.roles = [];
            }

log.debug({authzOpts: authzOpts}, 'XXX mahi authorize attempt');

            try {
                mahi.authorize(authzOpts);
            } catch (e) {
                log.debug({err: e, authzOpts: authzOpts},
                    'mahi authorize failure');
                next2(new NotAuthorizedError(e, FORBIDDEN,
                    authzOpts.resource.key + ' (' + authzOpts.action + ')'));
                return;
            }

            // We may need this for later use if we are creating new resources and
            // the sub-user didn't specify any role.tag:
            req.activeRoles = ctx.activeRoles;

            next2();
        }
    ]}, function (err) {
        next(err);
    });
}


///--- Exports

module.exports = {
    authnSignature: authnSignature,
    authnToken: authnToken,
    authnAssert: authnAssert,

    authzAccount: authzAccount,
    authzAllowedDcs: authzAllowedDcs,
    authzRbac: authzRbac
};
