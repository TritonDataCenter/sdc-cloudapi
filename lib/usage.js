// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var restify = require('restify');
var clone = require('clone');

var InvalidArgumentError = restify.InvalidArgumentError;

var sprintf = util.format;

function usage(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var period = req.params.period;

    if (!period.match(/^[0-9]{4}-[0-9]{1,2}$/)) {
        return next(new InvalidArgumentError(
                'period (string, YYYY-MM) required'));
    }

    var begin = new Date(period);
    var end = clone(begin);
    var finish = new Date(end.setMonth(end.getMonth() + 1));

    var opt = {
        start: begin.toISOString(),
        finish: finish.toISOString(),
        owners: customer
    };

    return req.sdc.usageapi.getReport(opt, function (er1, report) {
        if (er1) {
            // Either the report does not exists, and we need to generate, or
            // there's something else going on:
            if (er1.statusCode === 404) {
                return req.sdc.usageapi.generateReport(opt, function (er2, l) {
                    if (er2) {
                        return next(er2);
                    }
                    res.send(204, {status: 'queued', report: {}});
                    return next();
                });
            } else {
                return next(er1);
            }
        } else {
            log.debug('GetUsageReport(%s/%s) => %j', customer, period, report);
            res.send((report.status !== 'done' ? 204 : 200), report);
            return next();
        }
    });
}

function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.get({
        path: '/:account/usage',
        name: 'GetAccountUsage'
    }, before, usage);

    return server;
}

///--- Exports

module.exports = {
    mount: mount
};
