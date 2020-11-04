/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * Adapted from restify/lib/plugins/audit.js
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');
var HttpError = require('restify').HttpError;


// --- API

/**
 * Returns a Bunyan audit logger suitable to be used in a server.on('after')
 * event.  I.e.:
 *
 * server.on('after', restify.auditLogger({ log: myAuditStream }));
 *
 * This logs at the INFO level.
 *
 * @param {Object} options at least a bunyan logger (log).
 * @return {Function} to be used in server.after.
 */
function auditLogger(options) {
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');

    var log = options.log.child({
        audit: true,
        serializers: {
            err: bunyan.stdSerializers.err,
            req: function auditRequestSerializer(req) {
                if (!req) {
                    return (false);
                }

                var timers = {};
                (req.timers || []).forEach(function (time) {
                        var t = time.time;
                        var _t = Math.floor((1000000 * t[0]) +
                                            (t[1] / 1000));
                        timers[time.name] = _t;
                });
                return ({
                    method: req.method,
                    url: req.url,
                    headers: req.headers,
                    httpVersion: req.httpVersion,
                    trailers: req.trailers,
                    version: req.version,
                    body: options.body === true ?
                        req.body : undefined,
                    timers: timers
                });
            },
            res: function auditResponseSerializer(res) {
                if (!res) {
                    return (false);
                }

                var body;
                if (options.body === true) {
                    if (res._body instanceof HttpError) {
                        body = res._body.body;
                    } else {
                        body = res._body;
                    }
                }

                return ({
                    statusCode: res.statusCode,
                    headers: res._headers,
                    trailer: res._trailer || false,
                    body: body
                });
            }
        }
    });

    function audit(req, res, route, err) {
        // Skip logging HAproxy ping requests.
        if (req.path() === '/--ping' && req.method === 'GET') {
            return undefined;
        }
        var latency = res.get('Response-Time');
        if (typeof (latency) !== 'number') {
            latency = Date.now() - req._time;
        }

        var obj = {
            remoteAddress: (req.connection._xff) ? req.connection._xff :
                req.connection.remoteAddress,
            remotePort: req.connection.remotePort,
            req_id: req.getId(),
            req: req,
            res: res,
            err: err,
            latency: latency,
            route: route && route.name,
            secure: req.secure,
            _audit: true
        };

        // Emit warn on 5xx to trigger RequestCaptureStream.
        log[res.statusCode >= 500 ? 'warn' : 'info'](
            obj, 'handled: %d', res.statusCode);

        return (true);
    }

    return (audit);
}



// -- Exports

module.exports = auditLogger;
