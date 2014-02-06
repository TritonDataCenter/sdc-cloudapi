// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var restify = require('restify');


///--- Helpers

function translate(snapshot, version) {
    assert.ok(snapshot);
    if (!version) {
        version = '*';
    }

    var state = (!/6\.5/.test(version)) ? 'created' : 'success';

    return {
        name: snapshot.name,
        state: (snapshot.creation_state === 'succeeded') ? state :
            snapshot.creation_state,
        created: snapshot.created_at,
        updated: snapshot.created_at
    };
}

function filterSnapshotName(name) {
    if (/^(.*)@(.*)$/.test(name)) {
        return name.replace(/^(.*)@(.*)$/, '$2');
    }
    return name;
}

function snapshotName() {
    var d = new Date();

    function pad(n) {
        return String(n < 10 ? '0' + n : n);
    }

    return String(d.getUTCFullYear()) +
        pad(d.getUTCMonth() + 1) +
        pad(d.getUTCDate()) + 'T' +
        pad(d.getUTCHours()) +
        pad(d.getUTCMinutes()) +
        pad(d.getUTCSeconds() + 'Z');
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
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid,
        name: name
    }, {
        headers: {
            'x-request-id': req.getId()
        }
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
                    req.account.login, machine.uuid, snapshot);
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
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid,
        name: name
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, job) {
        if (err) {
            return next(err);
        }

        log.debug('POST /%s/machines/%s/snapshots/%s -> ok',
                    req.account.login, machine.uuid, name);
        res.send(202);
        return next();
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var name = req.params.machine;
    var vmapi = req.sdc.vmapi;
    var jobs_statuses = {};

    return req.sdc.vmapi.getVm({
        uuid: name,
        owner_uuid: customer,
        sync: true
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, machine) {
        if (err) {
            return next(err);
        }

        return vmapi.listJobs({
                vm_uuid: name,
                task: 'snapshot'
            }, {
                headers: {
                    'x-request-id': req.getId()
                }
            }, function (err1, jobs) {
                if (err1) {
                    return next(err1);
                } else {
                    if (jobs.length) {
                        jobs.filter(function (job) {
                            return (/^snapshot/.test(job.name));
                        }).map(function (job) {
                            jobs_statuses[job.params.snapshot_name] =
                                job.execution;
                            return job;
                        });
                    }

                    var snaps = machine.snapshots;

                    snaps = snaps.map(function (s) {
                        s.name = filterSnapshotName(s.name);
                        s.creation_state = jobs_statuses[s.name];
                        return s;
                    }).map(translate, req.getVersion());

                    log.debug('GET /%s/machines/%s/snapshots -> %j',
                              req.account.login, machine.uuid, snaps);

                    res.send(snaps);
                    return next();
                }
            });
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var vm_uuid = req.params.machine;
    var vmapi = req.sdc.vmapi;
    var name = req.params.name;
    var snapshot_job;

    return req.sdc.vmapi.getVm({
        uuid: vm_uuid,
        owner_uuid: customer
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, machine) {
        if (err) {
            return next(err);
        }

        return vmapi.listJobs({
                vm_uuid: vm_uuid,
                task: 'snapshot'
            }, {
                headers: {
                    'x-request-id': req.getId()
                }
            }, function (err1, jobs) {
                if (err1) {
                    return next(err1);
                } else {
                    var snapshots_jobs = [];
                    if (jobs.length) {
                        snapshots_jobs = jobs.filter(function (job) {
                            return (/^snapshot/.test(job.name) &&
                                job.params.snapshot_name === name);
                        });
                    }

                    if (jobs.length === 0 || snapshots_jobs.length === 0) {
                        return next(new restify.ResourceNotFoundError(
                                'Snapshot does not exist'));
                    }

                    snapshot_job = snapshots_jobs[0];

                    var snaps = machine.snapshots;

                    snaps = snaps.map(function (s) {
                        s.name = filterSnapshotName(s.name);
                        return s;
                    }).filter(function (s) {
                        return (s.name === name);
                    });

                    var snapshot = (snaps.length === 0) ? {
                        name: name,
                        creation_state: 'deleted'
                    }: snaps[0];

                    if (!snapshot.creation_state) {
                        snapshot.creation_state = snapshot_job.execution;
                    }

                    var snap = translate(snapshot, req.getVersion());
                    log.debug('GET /%s/machines/%s/snapshots/%s -> %j',
<<<<<<< HEAD
<<<<<<< HEAD
                                req.account.login, vm_uuid, name, snap);
=======
                                req.account.login, machine.uuid, name, snap);
>>>>>>> 576cd31... PAPI-27 - some logging statements in resize tests were mislogging the
=======
                                req.account.login, machine.uuid, name, snap);
>>>>>>> b3ffc05... PAPI-27 - some logging statements in resize tests were mislogging the

                    res.send(snap);
                    return next();

                }
            });

    });
}


function del(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var machine = req.params.machine;
    var vmapi = req.sdc.vmapi;
    var name = req.params.name;

    return vmapi.deleteSnapshot({
        uuid: machine,
        owner_uuid: customer,
        origin: req.params.origin || 'cloudapi',
        creator_uuid: req.account.uuid,
        name: name
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function (err, job) {
        if (err) {
            return next(err);
        }

        log.debug('DELETE /%s/machines/%s/snapshots/%s -> ok',
                    req.account.login, machine.uuid, name);
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
