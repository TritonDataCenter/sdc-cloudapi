/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert');
var util = require('util');
var sprintf = util.format;

// We cannot test vms provisioning neither status changes without querying
// jobs execution directly. Former approach of checking vms status changes
// assumes that jobs which may cause machine status changes will always
// succeed, which is not the case.
function checkJob(client, id, callback) {
    return client.vmapi.getJob(id, function (err, job) {
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
    return checkJob(client, id, function (err, ready) {
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
    t.ok(m.name, 'checkMachine name ok');
    t.ok(m.type, 'checkMachine type ok');
    t.ok(m.state, 'checkMachine state ok');
    t.ok((m.dataset || m.image), 'checkMachine dataset ok');
    t.ok(m.ips, 'checkMachine ips ok');
    t.ok(m.memory, 'checkMachine memory ok');
    t.ok(m.metadata, 'checkMachine metadata ok');
    t.ok(m['package'], 'checkMachine package ok');
    // TODO:
    // Intentionally making disk, which is zero first, and created/updated,
    // which are not set at the beginning, fail until we decide how to proceed
    // t.ok(m.disk, 'checkMachine disk ok');
    // t.ok(m.created, 'checkMachine created ok');
    // t.ok(m.updated, 'checkMachine updated ok');
    t.ok(typeof (m.disk) !== 'undefined', 'Machine disk');
    t.ok(typeof (m.created) !== 'undefined', 'Machine created');
    t.ok(typeof (m.updated) !== 'undefined', 'Machine updated');
}


function checkWfJob(client, id, callback) {
    return client.wfapi.get(sprintf('/jobs/%s', id),
                            function (err, req, res, job) {
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
    return checkWfJob(client, id, function (err, ready) {
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


function saveKey(key, keyName, client, t, cb) {
    return client.post('/my/keys', {
        key: key,
        name: keyName
    }, function (err2, req, res, body) {
        t.ifError(err2, 'POST /my/keys error');
        return cb();
    });
}


function addPackage(client, pkg, cb) {
    return client.papi.get(pkg.uuid, {}, function (err, p) {
        if (err) {
            if (err.restCode === 'ResourceNotFound') {
                return client.papi.add(pkg, function (err2, entry) {
                    return cb(err2, entry);
                });
            } else {
                return cb(err);
            }
        } else {
            return cb(null, p);
        }
    });
}

module.exports = {
    checkJob: checkJob,
    waitForJob: waitForJob,
    checkMachine: checkMachine,
    saveKey: saveKey,
    checkWfJob: checkWfJob,
    waitForWfJob: waitForWfJob,
    addPackage: addPackage
};
