// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert-plus');
var util = require('util');


function translateAction(job) {

    if (/^provision/.test(job.name)) {
        return 'provision';
    }

    if (job.params.task !== 'update' && job.params.task !== 'snapshot') {
        return job.params.task;
    }

    if (job.params.task === 'snapshot') {
        if (/^snapshot/.test(job.name)) {
            return 'create_snapshot';
        } else if (/^rollback/.test(job.name)) {
            return 'rollback_snapshot';
        } else if (/^delete-snapshot/.test(job.name)) {
            return 'delete_snapshot';
        }
    }

    // The multiple possibilities for machine update:
    if (job.params.set_customer_metadata &&
            job.params.remove_customer_metadata) {
        return 'replace_metadata';
    }

    if (job.params.remove_tags && job.params.set_tags) {
        return 'replace_tags';
    }

    if (job.params.remove_customer_metadata) {
        return 'remove_metadata';
    }

    if (job.params.set_customer_metadata) {
        return 'set_metadata';
    }

    if (job.params.remove_tags) {
        return 'remove_tags';
    }

    if (job.params.set_tags) {
        return 'set_tags';
    }

    if (job.params.alias) {
        return 'rename';
    }

    if (job.params.ram || job.params.quota) {
        return 'resize';
    }

    return 'unknown';
}

function translate(job) {
    var j = {
        success: (job.execution === 'succeeded') ? 'yes' : 'no',
        time: job.chain_results[job.chain_results.length - 1].finished_at
    };
    j.action = translateAction(job);
    if (job.params.context) {
        j.caller = job.params.context.caller;
        j.parameters = job.params.context.parameters;
    } else {
        j.caller = {
            type: 'operator'
        };
    }
    return j;
}

function list(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        log = req.log,
        machine = req.params.machine,
        vmapi = req.sdc.vmapi;

    return vmapi.listJobs({
        vm_uuid: machine,
        owner_uuid: customer
    }, {
        headers: {
            'x-request-id': req.getId(),
            'request-id': req.getId()
        }
    }, function (err, jobs) {
        if (err) {
            return next(err);
        }

        // Ignore all not finished jobs
        var actions = jobs.filter(function (j) {
            return (j.execution !== 'running' && j.execution !== 'queued');
        }).map(translate);

        log.debug('GET %s -> %j', req.path(), actions);
        res.send(actions);
        return next();
    });
}


function mount(server, before) {
    assert.object(server, 'server');
    assert.ok(before);

    server.get({
        path: '/:account/machines/:machine/audit',
        name: 'GetAudit'
    }, before, list);

    server.head({
        path: '/:account/machines/:machine/audit',
        name: 'HeadAudit'
    }, before, list);
}

// Shamelessly copied from restify.auditLogger for customization:


var bunyan = require('bunyan');
var restify = require('restify');
var HttpError = restify.HttpError;


//--- API

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

                return ({
                    method: req.method,
                    url: req.url,
                    headers: req.headers,
                    httpVersion: req.httpVersion,
                    trailers: req.trailers,
                    version: req.version,
                    body: options.body === true ? req.body : undefined
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
            remoteAddress: req.connection.remoteAddress,
            remotePort: req.connection.remotePort,
            req_id: req.getId(),
            req: req,
            res: res,
            err: err,
            latency: latency,
            secure: req.secure,
            _audit: true
        };

        log.info(obj, 'handled: %d', res.statusCode);

        return (true);
    }

    return (audit);
}


// --- API

module.exports = {
    mount: mount,
    auditLogger: auditLogger
};
