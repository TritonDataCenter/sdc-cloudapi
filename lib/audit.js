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

    if (job.params.subtask === 'rename' || job.params.subtask === 'resize') {
        return job.params.subtask;
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
        log: req.log,
        headers: {
            'x-request-id': req.getId()
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
        name: 'MachineAudit'
    }, before, list);

    server.head({
        path: '/:account/machines/:machine/audit',
        name: 'HeadAudit'
    }, before, list);
}


// --- API

module.exports = {
    mount: mount
};
