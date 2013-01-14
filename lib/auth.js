// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var httpSignature = require('http-signature');
var restify = require('restify');



///--- Globals

var BadRequestError = restify.BadRequestError;
var InvalidCredentialsError = restify.InvalidCredentialsError;
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
    if (scheme.toLowerCase() !== 'basic')
        return next();

    var log = req.log;
    var ufds = req.sdc.ufds;

    var user = req.authorization.basic.username;
    var pass = req.authorization.basic.password;
    if (!user || !pass)
        return next(new InvalidCredentialsError(MISSING_CREDS));


    log.debug('basicAuth: authorization=%j', req.authorization);
    return ufds.authenticate(user, pass, function (err, customer) {
        if (err) {
            if (err.statusCode === 404)
                return next(new InvalidCredentialsError(USER_404, user));

            return next(new InvalidCredentialsError(DEF_401));
        }

        req.caller = customer;
        req.username = req.caller.login;
        return next();
    });
}


function signatureAuth(req, res, next) {
    assert.ok(req.log);
    assert.ok(req.sdc);

    var scheme = req.authorization.scheme || '';
    if (scheme.toLowerCase() !== 'signature')
        return next();

    var keyId;
    var log = req.log;
    var sig = req.authorization.signature;
    var ufds = req.sdc.ufds;

    try {
        keyId = sig.keyId.split('/');
    } catch (e) {
        log.info('Error parsing authorization header: %s', e.stack);
        return next(new BadRequestError(INVALID_AUTHZ));
    }

    if (!keyId || keyId.length !== 4 || keyId[2] !== 'keys') {
        return next(new InvalidCredentialsError(INVALID_KEY, sig.keyId));
    }

    return ufds.getUser(keyId[1], function (err, account) {
        if (err) {
            return next(new InvalidCredentialsError(INVALID_ERR,
                                                    'account',
                                                    keyId[1]));
        }


        return account.getKey(keyId[3], function (err2, key) {
            if (err2) {
                return next(new InvalidCredentialsError(INVALID_ERR,
                                                        'key',
                                                        keyId[3]));
            }

            log.debug('authSig using key %s => %s', sig.keyId, key.pkcs);
            try {
                if (!httpSignature.verifySignature(sig, key.pkcs)) {
                    log.debug('authSig::verify FAIL: %j, key=%s',
                                sig, key.standard);
                    return next(new InvalidCredentialsError(INVALID_SIG));
                }

                if (!req.header('X-Auth-Token')) {
                    req.caller = account;
                    req.username = account.login;
                    return next();
                } else {
                    var token = JSON.parse(req.header('X-Auth-Token'));
                    var detokenizer = restify.createJsonClient({
                        url: req.sdc.keyapi
                    });

                    return detokenizer.post('/detoken', token,
                        function (clienterr, clientreq, clientres, clientobj) {
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
                            for (var i = 0; i < perms.length; i++) {
                                var currperm = perms[i].split('/*');
                                if (currperm[0] == req.url) {
                                    authorized = true;
                                    break;
                                }
                                if (req.url.search(currperm[0]) === 0) {
                                    if (currperm.length == 2 &&
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
                }

            } catch (e) {
                log.debug('Error calling http_signature: ' + e.stack);
                return next(new InvalidCredentialsError(INVALID_SIG));
            }

        });
    });
}

function assertAuthenticated(req, res, next) {
    if (typeof (req.caller) !== 'object')
        return next(new InvalidCredentialsError(DEF_401));

    return next();
}


function loadAccount(req, res, next) {
    assert.ok(req.sdc);

    var log = req.log;
    var ufds = req.sdc.ufds;

    if (req.params.account === 'my') {
        req.params.account = req.caller.login;
    }
    req.params.account = decodeURIComponent(req.params.account);

    return ufds.getUser(req.params.account, function (err, customer) {
        if (err) {
            return next(err);
        }

        log.debug('loaded account %j', customer);
        req.account = customer;
        return next();
    });
}


function authorize(req, res, next) {
    assert.ok(req.account);
    assert.ok(req.caller);

    var account = req.account;
    var caller = req.caller;

    if ((account.uuid !== caller.uuid) && !caller.isAdmin())
        return next(new NotAuthorizedError(FORBIDDEN, account.login));

    return next();
}


function mount(server) {
    assert.argument(server, 'object', server);

    server.use(basicAuth);
    server.use(signatureAuth);
    server.use(assertAuthenticated);
    server.use(loadAccount);
    server.use(authorize);

    return server;
}



///--- Exports

module.exports = {
    basicAuth: basicAuth,
    signatureAuth: signatureAuth,
    assertAuthenticated: assertAuthenticated,
    loadAccount: loadAccount,
    authorize: authorize
};
