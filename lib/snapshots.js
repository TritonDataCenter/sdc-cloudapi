/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

var assert = require('assert-plus');
var util = require('util');
var restify = require('restify');


///--- Helpers

function translate(snapshot) {
    assert.ok(snapshot);

    return {
        name: snapshot.name,
        state: (snapshot.creation_state === 'succeeded') ? 'created' :
            snapshot.creation_state,
        size: snapshot.size,
        created: snapshot.created_at,
        updated: snapshot.created_at
    };
}


function filterSnapshotName(name) {
    assert.ok(name);

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
        pad(d.getUTCSeconds()) + 'Z';
}


function loadSnapshots(req, res, next) {
    req.sdc.vmapi.getVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid,
        fields: 'snapshots',
        sync: true
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function loadVm(err, machine) {
        if (err) {
            return next(err);
        }

        req.snapshots = machine.snapshots || [];
        return next();
    });
}


function loadSnapshotJobs(req, res, next) {
    req.sdc.vmapi.listJobs({
        vm_uuid: req.params.machine,
        task: 'snapshot'
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function loadJobs(err, jobs) {
        if (err) {
            return next(err);
        }

        req.snapshotJobs = jobs;
        return next();
    });
}


///--- Functions

function create(req, res, next) {
    assert.ok(req.sdc);

    var ownerUuid = req.account.uuid;
    var log = req.log;
    var vmapi = req.sdc.vmapi;
    var params = req.params;
    var vmUuid = params.machine;
    var name = params.name || snapshotName();

    if (req.machine.brand === 'bhyve') {
        if (!req.config.experimental_cloudapi_bhyve_snapshots) {
            next(new restify.InvalidArgumentError(
                'Snapshots of bhyve VMs are not allowed'));
            return;
        }
    }

    vmapi.snapshotVm({
        uuid: vmUuid,
        name: name,
        owner_uuid: ownerUuid,
        creator_uuid: ownerUuid,
        origin: params.origin || 'cloudapi',
        // Audit:
        context: {
            caller: req._auditCtx
        }
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function loadJob(err, job) {
        if (err) {
            return next(err);
        }

        // NOTE: Make the status match the job execution until it's succeeded
        // queued -> queued,
        // canceled -> canceled,
        // failed -> failed,
        // succeeded -> created
        var snapshot = {
            name: name,
            state: 'queued'
        };

        log.debug('POST /%s/machines/%s/snapshots -> %j',
                    req.account.login, vmUuid, snapshot);
        res.send(201, snapshot);
        return next();
    });
}


function boot(req, res, next) {
    assert.ok(req.sdc);

    var ownerUuid = req.account.uuid;
    var params = req.params;
    var vmUuid = params.machine;
    var name = params.name;

    req.sdc.vmapi.rollbackVm({
        uuid: vmUuid,
        name: name,
        owner_uuid: ownerUuid,
        creator_uuid: ownerUuid,
        origin: params.origin || 'cloudapi',
        // Audit:
        context: {
            caller: req._auditCtx
        }
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function bootJob(err, job) {
        if (err) {
            return next(err);
        }

        req.log.debug('POST /%s/machines/%s/snapshots/%s -> ok',
                    req.account.login, vmUuid, name);
        res.send(202);
        return next();
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.snapshots);
    assert.ok(req.snapshotJobs);

    var jobsStatuses = {};
    req.snapshotJobs.forEach(function (job) {
        jobsStatuses[job.params.snapshot_name] = job.execution;
    });

    var snapshots = req.snapshots.map(function (s) {
        s.name = filterSnapshotName(s.name);
        s.creation_state = jobsStatuses[s.name];
        return translate(s);
    });

    req.log.debug('GET /%s/machines/%s/snapshots -> %j',
                req.account.login, req.params.machine, snapshots);

    res.send(snapshots);
    return next();
}


function get(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.snapshots);
    assert.ok(req.snapshotJobs);

    var params = req.params;
    var name = params.name;

    var snapshotJob = req.snapshotJobs.filter(function (job) {
        return job.params.snapshot_name === name;
    })[0];

    if (!snapshotJob) {
        var errMsg = 'Snapshot does not exist';
        return next(new restify.ResourceNotFoundError(errMsg));
    }

    var snapshot = req.snapshots.filter(function (s) {
        s.name = filterSnapshotName(s.name);
        return s.name === name;
    })[0];

    snapshot = snapshot || {
        name: name,
        creation_state: 'deleted'
    };

    if (!snapshot.creation_state) {
        snapshot.creation_state = snapshotJob.execution;
    }

    var snap = translate(snapshot);
    req.log.debug('GET /%s/machines/%s/snapshots/%s -> %j',
                req.account.login, params.machine, name, snap);
    res.send(snap);
    return next();
}


function del(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.snapshots);

    var ownerUuid = req.account.uuid;
    var params = req.params;
    var vmUuid = params.machine;
    var name = params.name;

    var snapshot = req.snapshots.filter(function (snap) {
        return snap.name === name && snap.state !== 'deleted';
    })[0];

    if (!snapshot) {
        return next(new restify.ResourceNotFoundError('%s not found', name));
    }

    // calling a delete after a get leaves some room for a race, although
    // this isn't too significant here
    return req.sdc.vmapi.deleteSnapshot({
        uuid: vmUuid,
        name: name,
        owner_uuid: ownerUuid,
        creator_uuid: ownerUuid,
        origin: params.origin || 'cloudapi',
        // Audit:
        context: {
            caller: req._auditCtx
        }
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function deleteJob(err, job) {
        if (err) {
            return next(err);
        }

        req.log.debug('DELETE /%s/machines/%s/snapshots/%s -> ok',
                    req.account.login, vmUuid, name);
        res.send(204);
        return next();
    });
}


function mount(server, before) {
    assert.object(server);
    assert.ok(before);

    server.post({
        path: '/:account/machines/:machine/snapshots',
        name: 'CreateMachineSnapshot'
    }, before, create);

    server.post({
        path: '/:account/machines/:machine/snapshots/:name',
        name: 'StartMachineFromSnapshot'
    }, before, boot);

    server.get({
        path: '/:account/machines/:machine/snapshots',
        name: 'ListMachineSnapshots'
    }, before, loadSnapshots, loadSnapshotJobs, list);

    server.head({
        path: '/:account/machines/:machine/snapshots',
        name: 'HeadMachineSnapshots'
    }, before, loadSnapshots, loadSnapshotJobs, list);

    server.get({
        path: '/:account/machines/:machine/snapshots/:name',
        name: 'GetMachineSnapshot'
    }, before, loadSnapshots, loadSnapshotJobs, get);

    server.head({
        path: '/:account/machines/:machine/snapshots/:name',
        name: 'HeadMachineSnapshot'
    }, before, loadSnapshots, loadSnapshotJobs, get);

    server.del({
        path: '/:account/machines/:machine/snapshots/:name',
        name: 'DeleteMachineSnapshot'
    }, before, loadSnapshots, del);

    return server;
}



///--- Exports

module.exports = {
    mount: mount
};
