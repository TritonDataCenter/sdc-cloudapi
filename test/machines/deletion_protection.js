/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

var checkNotFound = require('../common').checkNotFound;
var waitForJob = require('./common').waitForJob;


// --- Tests


module.exports =
function deletionProtectionTests(suite, client, other, machineUuid, cb) {
    if (!machineUuid) {
        cb();
        return;
    }


    function waitForDeletionProtectionJob(t) {
        client.vmapi.listJobs({
            vm_uuid: machineUuid,
            task: 'update'
        }, function listJobsCb(err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs, 'list jobs OK');
            t.ok(jobs.length, 'update jobs is array');

            var protectionJobs = jobs.filter(function filterCb(job) {
                return (job.params.payload.indestructible_zoneroot !==
                    undefined);
            });

            t.ok(protectionJobs.length, 'protectionJobs is an array');
            waitForJob(client, protectionJobs[0].uuid, function waitCb(err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    }


    suite.test('Enable deletion_protection - other', function (t) {
        other.post('/my/machines/' + machineUuid, {
            action: 'enable_deletion_protection'
        }, function otherEnableCb(err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('Disable deletion_protection - other', function (t) {
        other.post('/my/machines/' + machineUuid, {
            action: 'disable_deletion_protection'
        }, function otherDisableCb(err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('Enable deletion_protection', function (t) {
        client.post('/my/machines/' + machineUuid, {
            action: 'enable_deletion_protection'
        }, function enableCb(err) {
            t.ifError(err, 'Enable deletion_protection error');
            t.end();
        });
    });


    suite.test('Wait For deletion_protection enabled job',
        waitForDeletionProtectionJob);


    suite.test('Check deletion_protection enabled', function (t) {
        client.get('/my/machines/' + machineUuid,
            function getCb(err, req, res, body) {

            t.ifError(err, 'GetMachine error');
            t.equal(body.deletion_protection, true, 'deletion_protection');

            t.end();
        });
    });


    suite.test('Disable deletion_protection', function (t) {
        client.post('/my/machines/' + machineUuid, {
            action: 'disable_deletion_protection'
        }, function disableCb(err) {
            t.ifError(err, 'Disable deletion_protection error');
            t.end();
        });
    });


    suite.test('Wait For deletion_protection disabled job',
        waitForDeletionProtectionJob);


    suite.test('Check deletion_protection disabled', function (t) {
        client.get('/my/machines/' + machineUuid,
            function getCb(err, req, res, body) {

            t.ifError(err, 'GetMachine error');
            t.equal(body.deletion_protection, undefined, 'deletion_protection');

            t.end();
        });
    });


    cb();
};
