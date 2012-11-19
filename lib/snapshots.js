// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var async = require('async');



///--- Helpers

function translate(snapshot) {
    assert.ok(snapshot);

    return {
        name: snapshot.name,
        state: snapshot.creation_state
        // Intentionally commenting out, since those are just not implemented
        // for SDC 7.0, and not documented as return values for SDC 6.5
        //created: snapshot.created_at,
        //updated: snapshot.updated_at
    };
}


function snapshotName() {
    var d = new Date();

    function pad(n) {
        return String(n < 10 ? '0' + n : n);
    }

    return String(d.getUTCFullYear()) +
        pad(d.getUTCMonth() + 1) +
        pad(d.getUTCDate()) +
        pad(d.getUTCHours()) +
        pad(d.getUTCMinutes()) +
        pad(d.getUTCSeconds());
}



///--- Functions

function create(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var vmapi = req.sdc.vmapi;
    var name = req.params.name || snapshotName();

    var snapshot;
    return vmapi.snapshotVm({
        uuid: machine,
        owner_uuid: customer,
        name: name
    }, function (err, job) {
        if (err) {
            return next(err);
        }

        // NOTE: Make the status match the job execution until it's succeeded
        // queued -> queued,
        // canceled -> canceled,
        // failed -> failed,
        // succeeded -> created
        snapshot = {
            name: name,
            state: 'queued'
        };

        log.debug('POST /%s/machines/%s/snapshots -> %j',
                  req.account.login, machine, snapshot);
        res.send(201, snapshot);
        return next();
    });
}


function boot(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var vmapi = req.sdc.vmapi;
    var name = req.params.name;

    return vmapi.rollbackVm({
        uuid: machine,
        owner_uuid: customer,
        name: name
    }, function (err, job) {
        if (err) {
            return next(err);
        }

        log.debug('POST /%s/machines/%s/snapshots/%s -> ok',
                  req.account.login, machine, name);
        res.send(202);
        return next();
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var mapi = req.sdc.mapi;

    return mapi.listZoneSnapshots(customer, machine, function (err, snaps) {
        if (err)
            return next(err);

        snaps = snaps.map(translate);
        log.debug('GET /%s/machines/%s/snapshots -> %j',
                  req.account.login, machine, snaps);
        res.send(snaps);
        return next();
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var mapi = req.sdc.mapi;
    var name = req.params.name;

    return mapi.getZoneSnapshot(customer, machine, name, function (err, snap) {
        if (err)
            return next(err);

        snap = translate(snap);
        log.debug('GET /%s/machines/%s/snapshots/%s -> %j',
                  req.account.login, machine, name, snap);
        res.send(snap);
        return next();
    });
}


function del(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var mapi = req.sdc.mapi;
    var name = req.params.name;

    return mapi.deleteZoneSnapshot(customer, machine, name, function (err) {
        if (err)
            return next(err);

        log.debug('DELETE /%s/machines/%s/snapshots/%s -> ok',
                  req.account.login, machine, name);
        res.send(204);
        return next();
    });
}


function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.post({
        path: '/:account/machines/:machine/snapshots',
        name: 'CreateSnapshot'
    }, before, create);

    server.post({
        path: '/:account/machines/:machine/snapshots/:name',
        name: 'BootSnapshot'
    }, before, boot);

    server.get({
        path: '/:account/machines/:machine/snapshots',
        name: 'ListSnaphots'
    }, before, list);

    server.head({
        path: '/:account/machines/:machine/snapshots',
        name: 'HeadSnapshots'
    }, before, list);

    server.get({
        path: '/:account/machines/:machine/snapshots/:name',
        name: 'GetSnapshot'
    }, before, get);

    server.head({
        path: '/:account/machines/:machine/snapshots/:name',
        name: 'HeadSnapshot'
    }, before, get);

    server.del({
        path: '/:account/machines/:machine/snapshots/:name',
        name: 'DeleteSnapshot'
    }, before, del);

    return server;
}



///--- Exports

module.exports = {
    mount: mount
};
