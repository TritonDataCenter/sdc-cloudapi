/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert');
var sprintf = require('util').format;
var common = require('../common');


// --- Globals


var TAG_KEY = 'role';
var TAG_VAL = 'unitTest';

var META_KEY = 'foo';
var META_VAL = 'bar';

var META_64_KEY = 'sixtyfour';
var META_64_VAL = new Buffer('Hello World').toString('base64');

var META_CREDS = {
    root: 'secret',
    admin: 'secret'
};


// -- Helpers


// We cannot test vms provisioning neither status changes without querying
// jobs execution directly. Former approach of checking vms status changes
// assumes that jobs which may cause machine status changes will always
// succeed, which is not the case.
function checkJob(client, id, callback) {
    client.vmapi.getJob(id, function (err, job) {
        if (err) {
            return callback(err);
        }

        if (job.execution === 'failed') {
            return callback(new Error(sprintf('Job %s failed', job.uuid)));
        }

        return callback(null, (job ? job.execution === 'succeeded' : false));
    });
}


function waitForJob(client, id, callback) {
    assert.ok(client);
    // console.log('waiting for job with uuid: %s', uuid);
    checkJob(client, id, function (err, ready) {
        if (err) {
            return callback(err);
        }
        if (!ready) {
            return setTimeout(function () {
                waitForJob(client, id, callback);
            }, (process.env.POLL_INTERVAL || 500));
        }
        return callback(null);
    });
}


function checkMachine(t, m) {
    t.ok(m, 'checkMachine ok');
    t.ok(m.id, 'checkMachine id ok');
    t.ok(m.type, 'checkMachine type ok');
    t.ok(m.state, 'checkMachine state ok');
    t.ok((m.dataset || m.image), 'checkMachine dataset ok');
    t.ok(m.ips, 'checkMachine ips ok');
    t.ok(m.memory, 'checkMachine memory ok');
    t.ok(m.metadata, 'checkMachine metadata ok');
    t.notOk(m.docker, 'checkMachine docker attr not set');

    if (m.state === 'running') {
        t.ok(m.primaryIp, 'checkMachine primaryIp ok');
    }

    // Sometimes test suites from other applications create zones with a
    // 00000000-0000-0000-0000-000000000000 billing_id, which is changed by
    // cloudapi to '' since it's not an actual package UUID. Alas, we work
    // around that here, due to inertia.
    if (m['package'] !== '') {
        t.ok(m['package'], 'checkMachine package ok');
    }

    // TODO:
    // Intentionally making disk, which is zero first, and created/updated,
    // which are not set at the beginning, fail until we decide how to proceed
    // t.ok(m.disk, 'checkMachine disk ok');
    // t.ok(m.created, 'checkMachine created ok');
    // t.ok(m.updated, 'checkMachine updated ok');
    t.ok(typeof (m.disk) !== 'undefined', 'checkMachine disk');
    t.ok(typeof (m.created) !== 'undefined', 'checkMachine created');
    t.ok(typeof (m.updated) !== 'undefined', 'checkMachine updated');
}


function checkWfJob(client, id, callback) {
    client.wfapi.get(sprintf('/jobs/%s', id), function (err, req, res, job) {
        if (err) {
            return callback(err);
        }

        if (job.execution === 'failed') {
            return callback(new Error('Job failed'));
        }

        return callback(null, (job ? job.execution === 'succeeded' : false));
    });
}


function waitForWfJob(client, id, callback) {
    // console.log('waiting for job with uuid: %s', id);
    checkWfJob(client, id, function (err, ready) {
        if (err) {
            return callback(err);
        }

        if (!ready) {
            return setTimeout(function () {
                waitForWfJob(client, id, callback);
            }, (process.env.POLL_INTERVAL || 500));
        }
        return callback(null);
    });
}


function waitForRunningMachine(client, machineUuid, cb) {
    client.vmapi.listJobs({
        vm_uuid: machineUuid,
        task: 'provision'
    }, function (err, jobs) {
        if (err) {
            return cb(err);
        }

        var job = jobs[0];

        if (!job) {
            return cb(new Error('no provision job found'));
        }

        return waitForJob(client, job.uuid, cb);
    });
}


// TODO: This sucks. The first network here might NOT be provisionable: It
// might be junk from an earlier failed test.
function getProvisionableNetwork(client, cb) {
    client.get('/my/networks', function (err, req, res, body) {
        if (err) {
            return cb(err);
        }

        var net = body[0];

        return cb(null, net);
    });
}


function createMachine(t, client, obj, cb) {
    obj['metadata.' + META_KEY] = META_VAL;
    obj['metadata.' + META_64_KEY] = META_64_VAL;
    obj['metadata.credentials'] = META_CREDS;
    obj['tag.' + TAG_KEY] = TAG_VAL;

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ifError(err, 'createMachine');
        t.equal(res.statusCode, 201, 'createMachine 201 statusCode');
        t.equal(res.headers.location,
            sprintf('/%s/machines/%s', client.login, body.id),
            'createMachine Location header');
        t.ok(body, 'createMachine body' + (body ? ': '+body.id : ''));
        common.checkHeaders(t, res.headers);
        checkMachine(t, body);

        cb(null, body && body.id);
    });
}


function getMachine(t, client, machineUuid, cb) {
    if (!machineUuid) {
        return cb();
    }

    var path = '/my/machines/' + machineUuid;

    return client.get(path, function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines/:id error');
        t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
        t.ok(body, 'GET /my/machines/:id body');
        t.ok(body.compute_node, 'machine compute_node');
        t.ok(body.firewall_enabled, 'machine firewall enabled');
        t.ok(Array.isArray(body.networks), 'machine networks array');
        t.equal(typeof (body.metadata.credentials), 'undefined');

        common.checkHeaders(t, res.headers);
        common.checkReqId(t, res.headers);
        checkMachine(t, body);

        cb(null, body);
    });
}


module.exports = {
    checkJob: checkJob,
    checkMachine: checkMachine,
    checkWfJob: checkWfJob,
    createMachine: createMachine,
    getMachine: getMachine,
    getProvisionableNetwork: getProvisionableNetwork,
    waitForJob: waitForJob,
    waitForWfJob: waitForWfJob,
    waitForRunningMachine: waitForRunningMachine,

    TAG_KEY: TAG_KEY,
    TAG_VAL: TAG_VAL,
    META_CREDS: META_CREDS
};
