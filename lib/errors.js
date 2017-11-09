/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Error classes that CloudAPI may produce are defined or re-exported from here.
 *
 * *
 * Warning: The use of this error module is far from univeral in CloudAPI,
 * mainly because this file came later in its dev. CloudAPI code often all
 * just passes through errors from SDC API clients. As a result, read this
 * CloudAPI error plan as aspirational.
 * *
 *
 *
 * # Goals
 *
 * 1. Respond with meaningful error responses that don't expose internal and
 *    implementation details.
 * 2. Log relevant error details for debugging and analysis.
 * 3. Have a reasonably elegant API for raising errors in the sdc-cloudapi code.
 *
 * One of the main sources of error information is the error responses from
 * internal SDC APIs (VMAPI, CNAPI, etc.). Goal #1 basically means whitelisting
 * details from internal errors.
 *
 *
 * # Guidelines for sdc-cloudapi errors
 *
 * - Never return a raw internal SDC API error. Always wrap them with one of
 *   the `errors.${api}ErrorWrap` methods:
 *          callback(errors.vmapiErrorWrap(
 *              err, 'problem creating machine'));
 *   or using one of the error classes in this module, e.g.:
 *          res.send(new errors.CloudApiError('error deleting tag'));
 *
 * - If using the generic `CloudApiError` class, pass in any cause `err`:
 *          callback(new errors.CloudApiError(err,
 *              'this message is exposed to the user'));
 *   The `err` is then logged internally (a Good Thing), but details aren't
 *   exposed to the user of cloudapi.
 *
 * - If there is a useful category of errors, then create a custom error class
 *   for it. See `ACustomError` and `IAmATeapotError` templates below. A custom
 *   class has three effects:
 *
 *      (a) its restCode is logged as `err.code`
 *
 *      (b) its restCode (e.g. "ResourceNotFound") is shown in the client-side
 *          error message, at least by the `triton` client, e.g.:
 *
 *              $ triton inst tag delete vm0 bar
 *              triton inst: error (ResourceNotFound): tag 'bar' not found
 *                                  ^^^^^^^^^^^^^^^^
 *
 *      (c) it is easy to grep for that class of errors in sdc-cloudapi code.
 *
 *
 * # Error Hierarchy
 *
 *  verror.VError
 *      restify.HttpError
 *          restify.RestError
 *
 *              # The subset of core restify errors that are used.
 *              restify.ResourceNotFoundError
 *              ...
 *
 *              # Error used by the `${api}ErrorWrap` methods
 *              ExposedSDCError      This exposes body.errors, restCode, and
 *                                   statusCode from the given cause error.
 *
 *      # Custom error classes for this package
 *      _CloudApiBaseError
 *          CloudApiError        generic catch all; exposes cause.statusCode
 *          ...
 *
 *
 * # Background
 *
 * See <https://github.com/joyent/eng/blob/master/docs/index.md#error-handling>
 * for Joyent Eng Guidelines on REST API error response bodies.
 *
 * A Bunyan-logged error looks like this:
 *
 *      ...
 *      "err": {
 *        "message": "problem creating mach...",
 *        "name": "WError",
 *        "stack": "SDCClientError: problem creating mach..."
 *        "code": "ValidationFailed",
 *        "errors": [
 *          {
 *            "field": "alias",
 *            "code": "Duplicate",
 *            "message": "Already exists for this owner_uuid"
 *          }
 *        ]
 *      },
 *      ...
 */

var util = require('util'),
    format = util.format;
var assert = require('assert-plus');
var restify = require('restify');
var verror = require('verror'),
    VError = verror.VError;



// ---- error classes

/**
 * Base class for custom error classes. It provides a nice call signature
 * with variable args (a la `util.format`) and an optional leading "cause"
 * Error argument. (This is *similar* to `verror.VError`, but uses the more
 * lenient `util.format` behaviour rather than the strict sprintf which blows
 * up on a leading string with accidental format codes.) Calling forms:
 *
 *      new MyError('my message', ...);
 *      new MyError(cause, 'my message', ...);
 *      new MyError('my message with %d formats', arg1, arg2, ...);
 *
 * This class also asserts that subclass prototype has the following fields:
 * - restCode: A string used for the restCode.
 * - statusCode: An HTTP integer statusCode.
 *
 * This class shouldn't be exported, because all usages should be of one of the
 * subclasses.
 */
function _FriendlySigRestError(opts) {
    var ctor = this.constructor;
    assert.string(ctor.prototype.restCode, ctor.name + '.prototype.restCode');
    assert.number(ctor.prototype.statusCode,
        ctor.name + '.prototype.statusCode');

    /*
     * In versions of node since (I think) 0.10, `Error.toString()` does
     * not use `this.constructor.name`. Therefore to get that error subclass
     * name in printed errors and error.stack, we need to set `prototype.name`.
     */
    if (!ctor.prototype.hasOwnProperty('name')) {
        ctor.prototype.name = ctor.name;
    }

    var restErrorOpts = {
        restCode: ctor.prototype.restCode,
        statusCode: ctor.prototype.statusCode
    };
    var msgArgs;

    if (arguments[0] instanceof Error) {
        // `new <Error>(<err>, ...)`
        restErrorOpts.cause = arguments[0];
        msgArgs = Array.prototype.slice.call(arguments, 1);
    } else if (arguments.length === 0) {
        msgArgs = [];
    } else if (typeof (arguments[0]) === 'string') {
        // `new <Error>(<string>, ...)`
        msgArgs = Array.prototype.slice.call(arguments);
    } else {
        // `new <Error>(<not a string>, ...)`
        // Almost certainly an error, show `inspect(<not a string>)`.
        msgArgs = Array.prototype.slice.call(arguments);
        msgArgs[0] = util.inspect(msgArgs[0]);
    }
    if (msgArgs.length > 0 && msgArgs[0] === undefined) {
        msgArgs.shift();
    }
    restErrorOpts.message = format.apply(null, msgArgs);

    restify.RestError.call(this, restErrorOpts);
}
util.inherits(_FriendlySigRestError, restify.RestError);


/**
 * The generic catch-all error to use if there isn't a specific error class.
 *
 * If a cause error is given, then this error will steal (i.e. expose) its
 * `statusCode`. Other details (restCode, message, body) are *not* exposed.
 */
function CloudApiError() {
    _FriendlySigRestError.apply(this, arguments);

    // Steal the statusCode from the cause error, if any.
    var cause = this.cause();
    if (cause && cause.statusCode) {
        this.statusCode = cause.statusCode;
    }
}
util.inherits(CloudApiError, _FriendlySigRestError);
CloudApiError.prototype.restCode = 'CloudApiError';
CloudApiError.prototype.statusCode = 500;
CloudApiError.prototype.description = 'Encountered an internal error.';


/*
 * Custom error class templates:
 *
 * Here is a `ACustomError` class. It defines a statusCode and restCode, but
 * otherwise passes through the cause and message given at the call site:
 *
 *  function ACustomError() {
 *      _FriendlySigRestError.apply(this, arguments);
 *  }
 *  util.inherits(ACustomError, _FriendlySigRestError);
 *  ACustomError.prototype.restCode = 'ACustom';
 *  ACustomError.prototype.statusCode = 409;
 *  ACustomError.prototype.description = 'This custom thing broke.';
 *
 * Here is a `IAmATeapotError` class that hardwires an error message, but
 * still takes a cause:
 *
 *  function IAmATeapotError(cause) {
 *      assert.optionalObject(cause, 'cause');
 *      restify.RestError.call(this, {
 *          cause: cause,
 *          message: 'I am a teapot',
 *          statusCode: this.constructor.prototype.statusCode,
 *          restCode: this.constructor.prototype.restCode
 *      });
 *  }
 *  util.inherits(IAmATeapotError, restify.RestError);
 *  IAmATeapotError.prototype.restCode = 'IAmATeapotError';
 *  IAmATeapotError.prototype.statusCode = 418;
 *  IAmATeapotError.prototype.description = 'Earl grey. Hot.';
 *
 * Note: The ceremony over adding fields to the constructor prototype isn't
 * technically required right now, but does allow for generation of the
 * cloudapi docs' errors table -- as is being done in IMGAPI right now:
 *   https://github.com/joyent/sdc-imgapi/blob/master/lib/errors.js#L558-L605
 */



// ---- wrappers for API responses

/**
 * An error used to expose the error from a node-sdc-clients API request.
 *
 * This *prefers* they are following:
 *      https://github.com/joyent/eng/blob/master/docs/index.md#error-handling
 * but we have enough exceptions, even in APIs like IMGAPI that try hard
 * to be defensive.
 */
function ExposedSDCError(cause, message) {
    assert.object(cause, 'cause');
    assert.string(message, 'message');
    assert.string(cause.restCode, 'cause.restCode');
    assert.optionalObject(cause.body, 'cause.body');
    var body = cause.body || {};
    assert.optionalString(body.message, 'cause.body.message');

    var fullMsg = format('%s: %s', message,
        body.message || cause.message || cause.toString());

    restify.RestError.call(this, {
        cause: cause,
        message: fullMsg,
        restCode: cause.restCode,
        statusCode: cause.statusCode
    });
    if (body.errors) {
        this.body.errors = body.errors;
    }
}
util.inherits(ExposedSDCError, restify.RestError);


/**
 * Selectively expose some VMAPI error details via a whitelist on restCode.
 * Other VMAPI error codes are wrapped such that the error is *logged*, but
 * only the `statusCode` is exposed.
 *
 * Usage:
 *      next(new errors.vmapiErrorWrap(err, 'error deleting tag'));
 */
function vmapiErrorWrap(cause, message) {
    assert.object(cause, 'cause');
    assert.string(message, 'message');

    if (!cause) {
        return cause;
    } else if (!cause.restCode) {
        return new CloudApiError(cause, message);
    }

    switch (cause.restCode) {
        case 'ValidationFailed':
            return new ExposedSDCError(cause, message);

        /* By default don't expose internal error message details. */
        default:
            return new CloudApiError(cause, message);
    }
}

/**
 * Selectively expose some VOLAPI error details via a whitelist on restCode.
 * Other VOLAPI error codes are wrapped such that the error is *logged*, but
 * only the `statusCode` is exposed.
 *
 * Usage:
 *      next(new errors.volapiErrorWrap(err, 'error deleting tag'));
 */
function volapiErrorWrap(cause, message) {
    assert.object(cause, 'cause');
    assert.string(message, 'message');

    switch (cause.restCode) {
        case 'VolumeAlreadyExists':
        case 'VolumeInUse':
        case 'VolumeNotFound':
        case 'VolumeSizeNotAvailable':
        case 'ValidationError':
            return new ExposedSDCError(cause, message);

        /* By default don't expose internal error message details. */
        default:
            return new CloudApiError(cause, message);
    }
}

function DefaultFabricNetworkNotConfiguredError(cause) {
    assert.optionalObject(cause, 'cause');

    var errMsg = 'default_network is not configured for account';

    _FriendlySigRestError.call(this, cause, errMsg);
}

util.inherits(DefaultFabricNetworkNotConfiguredError, _FriendlySigRestError);
DefaultFabricNetworkNotConfiguredError.prototype.restCode =
    'DefaultFabricNetworkNotConfiguredError';
DefaultFabricNetworkNotConfiguredError.prototype.statusCode = 409;

function isDataVersionError(err) {
    assert.object(err, 'err');

    return err.name === 'DataVersionError';
}

function isInternalMetadataSearchError(err) {
    assert.object(err, 'err');

    return err.name === 'InternalServerError' &&
        err.message.indexOf('internal_metadata') !== -1;
}
// ---- exports

module.exports = {
    // Re-exported restify errors. Add more as needed.
    ResourceNotFoundError: restify.ResourceNotFoundError,
    InvalidArgumentError: restify.InvalidArgumentError,

    // Custom error classes.
    CloudApiError: CloudApiError,

    DefaultFabricNetworkNotConfiguredError:
        DefaultFabricNetworkNotConfiguredError,

    // Internal SDC API wrappers
    vmapiErrorWrap: vmapiErrorWrap,
    volapiErrorWrap: volapiErrorWrap,

    // Utility functions
    isDataVersionError: isDataVersionError,
    isInternalMetadataSearchError: isInternalMetadataSearchError
};
// vim: set softtabstop=4 shiftwidth=4:
