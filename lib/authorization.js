/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 * Copyright 2023 MNX Cloud, Inc.
 */

/*
 * A restify handler to parse the "Authorization" request header as supported
 * by cloudapi.
 */

var restify = require('restify');
// Deprecated http-signature 0.9.x. See PUBAPI-1187 for dropping this support.
var httpSig09 = require('./node-http-signature');
// Modern http-signature.
var httpSig = require('http-signature');

var errors = restify.errors;


// --- Globals

var InvalidHeaderError = errors.InvalidHeaderError;

var OPTIONS = {
    algorithms: [
        'rsa-sha1',
        'rsa-sha256',
        'rsa-sha384',
        'rsa-sha512',
        'dsa-sha1',
        'dsa-sha256',
        'ecdsa-sha256',
        'ecdsa-sha384',
        'ecdsa-sha512',
        'ed25519-sha256',
        'ed25519-sha512'
    ]
};



// --- Helpers

function parseBasic(string) {
    var decoded;
    var index;
    var pieces;

    decoded = (new Buffer(string, 'base64')).toString('utf8');
    if (!decoded) {
        throw new InvalidHeaderError('Authorization header invalid');
    }

    index = decoded.indexOf(':');
    if (index === -1) {
        pieces = [decoded];
    } else {
        pieces = [decoded.slice(0, index), decoded.slice(index + 1)];
    }

    if (!pieces || typeof (pieces[0]) !== 'string') {
        throw new InvalidHeaderError('Authorization header invalid');
    }

    // Allows for usernameless authentication
    if (!pieces[0]) {
        pieces[0] = null;
    }

    // Allows for passwordless authentication
    if (!pieces[1]) {
        pieces[1] = null;
    }

    return ({
        username: pieces[0],
        password: pieces[1]
    });
}


function parseSignature(request) {
    try {
        return (httpSig.parseRequest(request, OPTIONS));
    } catch (err) {
        try {
            var parsed = httpSig09.parseRequest(request, OPTIONS);
            parsed.is09 = true;
            return (parsed);
        } catch (_err09) {
            throw new InvalidHeaderError('Authorization header invalid: ' +
                err.message);
        }
    }
}



/**
 * Returns a plugin that will parse the client's Authorization header.
 *
 * Subsequent handlers will see `req.authorization`, which looks like:
 *
 * {
 *   scheme: <Basic|Signature|...>,
 *   credentials: <Undecoded value of header>,
 *   basic: {
 *     username: $user
 *     password: $password
 *   }
 * }
 *
 * `req.username` will also be set, and defaults to 'anonymous'.
 *
 * @return {Function} restify handler.
 * @throws {TypeError} on bad input
 */
function authorizationParser() {
    function parseAuthorization(req, res, next) {
        req.authorization = {};
        req.username = 'anonymous';

        if (!req.headers.authorization) {
            return (next());
        }

        var pieces = req.headers.authorization.split(' ', 2);
        if (!pieces || pieces.length !== 2) {
            var e = new InvalidHeaderError('BasicAuth content is invalid.');
            return (next(e));
        }

        req.authorization.scheme = pieces[0];
        req.authorization.credentials = pieces[1];

        try {
            switch (pieces[0].toLowerCase()) {
            case 'basic':
                req.authorization.basic = parseBasic(pieces[1]);
                req.username = req.authorization.basic.username;
                break;

            case 'signature':
                req.authorization.signature = parseSignature(req);
                req.username = req.authorization.signature.keyId;
                break;

            default:
                break;
            }
        } catch (e2) {
            return (next(e2));
        }

        return (next());
    }

    return (parseAuthorization);
}

module.exports = authorizationParser;
