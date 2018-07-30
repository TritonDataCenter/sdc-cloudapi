/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

var assert = require('assert-plus');
var util = require('util');


function translateAction(job) {
    var name    = job.name;
    var params  = job.params;
    var task    = params.task;
    var subtask = params.subtask;
    var payload = params.payload;

    if (task !== 'update' && task !== 'snapshot') {
        return task;
    }

    if (task === 'snapshot') {
        if (/^snapshot/.test(name)) {
            return 'create_snapshot';
        } else if (/^rollback/.test(name)) {
            return 'rollback_snapshot';
        } else if (/^delete-snapshot/.test(name)) {
            return 'delete_snapshot';
        }
    }

    if (subtask === 'rename' || subtask === 'resize') {
        return subtask;
    }

    // The multiple possibilities for machine update:
    if (payload.set_customer_metadata && payload.remove_customer_metadata) {
        return 'replace_metadata';
    }

    if (payload.indestructible_zoneroot === true) {
        return 'enable_deletion_protection';
    }

    if (payload.indestructible_zoneroot === false) {
        return 'disable_deletion_protection';
    }

    if (payload.remove_tags && payload.set_tags) {
        return 'replace_tags';
    }

    if (payload.remove_customer_metadata) {
        return 'remove_metadata';
    }

    if (payload.set_customer_metadata) {
        return 'set_metadata';
    }

    if (payload.remove_tags) {
        return 'remove_tags';
    }

    if (payload.set_tags) {
        return 'set_tags';
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
