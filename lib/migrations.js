/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var util = require('util');

var assert = require('assert-plus');
var restify = require('restify');

var MIGRATION_ACTIONS = [
    'begin',
    'sync',
    'switch',
    'automatic',
    'abort',
    'pause',
    'finalize'
];

/*
 * This is a sample migration object from VMAPI:
 * {
 *      automatic: false,
 *      created_timestamp: '2018-12-03T17:48:28.078Z',
 *      finished_timestamp: '2018-12-03T17:48:57.837Z',
 *      phase: 'start',
 *      state: 'paused',
 *      vm_uuid: '73f3db90-3fc3-46c7-92e9-b0cd337b9f7a',
 *      progress_history:
 *      [ {
 *          current_progress: 100,
 *          finished_timestamp: '2018-12-03T17:48:57.837Z',
 *          message: 'reserving instance',
 *          phase: 'start',
 *          state: 'success',
 *          started_timestamp: '2018-12-03T17:48:35.612Z',
 *          total_progress: 100
 *      } ]
 * }
 *
 * The only thing we are 'translating' so far is 'vm_uuid' with
 * 'machine'. We're not doing the mapping of "*whatever*_timestamp"
 * to just "*whatever*" in the traditional CloudAPI style, but keeping
 * the "_timestamp" string, since seems to be more clear.
 */

function translate(vmapiMigration) {
    assert.ok(vmapiMigration);
    assert.ok(vmapiMigration.vm_uuid);

    vmapiMigration.machine = vmapiMigration.vm_uuid;
    delete vmapiMigration.vm_uuid;

    return vmapiMigration;
}


function get(req, res, next) {
    assert.ok(req.sdc);

    req.sdc.vmapi.get({
        path: '/migrations/' + req.params.machine,
        query: {
            owner_uuid: req.account.uuid
        },
        headers: {
            'x-request-id': req.getId()
        }
    }, function loadVmMigrationCb(err, migration) {
        if (err) {
            // This is an attempt to load a migration for a different owner VM,
            // let's just 404 this:
            if (err.restCode === 'PreconditionFailed') {
                err = new restify.ResourceNotFoundError('VM not found');
            }
            next(err);
            return;
        }

        req.log.debug('GET /%s/migrations/%s -> %j',
            req.account.login, req.params.machine, migration);

        res.send(translate(migration));

        next();
    });
}

function list(req, res, next) {
    assert.ok(req.sdc);

    req.sdc.vmapi.get({
        path: '/migrations',
        query: {
            owner_uuid: req.account.uuid
        },
        headers: {
            'x-request-id': req.getId()
        }
    }, function loadMigrationsCb(err, vmapiMigrations) {
        if (err) {
            next(err);
            return;
        }

        var migrations = (vmapiMigrations || []).map(translate);

        req.log.debug('GET /%s/migrations -> %j',
                    req.account.login, migrations);

        res.send(migrations);
        next();
    });
}

function estimate(req, res, next) {
    assert.ok(req.sdc);

    var ownerUuid = req.account.uuid;
    var vmapi = req.sdc.vmapi;
    var vmUuid = req.params.machine;

    var opts = {
        action: 'migrate',
        migration_action: 'estimate',
        owner_uuid: ownerUuid,
        headers: {
            'x-request-id': req.getId()
        }
    };

    var vmapiPath = '/vms/' + vmUuid;

    vmapi.post(vmapiPath, opts, function estCb(err, estimation) {
        if (err) {
            next(err);
            return;
        }
        res.send(200, estimation);
        next();
    });
}

function watch(req, res, next) {
    assert.ok(req.sdc);

    var vmapi = req.sdc.vmapi;
    var params = req.params;
    var vmUuid = params.machine;

    if (params.action !== 'watch') {
        next();
        return;
    }

    var httpVmapi = restify.createHttpClient({url: vmapi.url});
    var requestPath = util.format('/migrations/%s/watch', vmUuid);

    httpVmapi.get(requestPath, function onMigrateWatchGet(getErr, vmapiReq) {
        if (getErr) {
            next(getErr);
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/x-json-stream' });
        vmapiReq.on('result', function onMigrateWatchResult(err, aRes) {
            if (err) {
                next(err);
                return;
            }
            aRes.on('data', function onDataCb(chunk) {
                res.write(chunk);
            });
            aRes.on('end', function resEndCb() {
                res.end();
                next();
            });

            res.pipe(aRes);
        });

        vmapiReq.end();
    });
}

function doAction(req, res, next) {
    assert.ok(req.sdc);

    var ownerUuid = req.account.uuid;
    var vmapi = req.sdc.vmapi;
    var params = req.params;
    var vmUuid = params.machine;

    if (!params.action) {
        next(new restify.MissingParameterError(
            '"action" must be specified'));
        return;
    }

    assert.string(params.action, 'params.action');

    if (params.action === 'watch') {
        next();
        return;
    }

    if (MIGRATION_ACTIONS.indexOf(params.action) === -1) {
        next(new restify.InvalidArgumentError(
            '%s is not a valid migration action',
            params.action));
        return;
    }

    var opts = {
        action: 'migrate',
        owner_uuid: ownerUuid,
        headers: {
            'x-request-id': req.getId()
        }
    };

    if (params.action === 'automatic') {
        opts.migration_automatic = 'true';
        opts.migration_action = 'begin';
    } else {
        opts.migration_action = params.action;
    }

    if (opts.action === 'begin' && params.affinity) {
        if (Array.isArray(params.affinity)) {
            opts.affinity = params.affinity;
        } else {
            opts.affinity = [params.affinity];
        }
    }

    var vmapiPath = util.format('/vms/%s', vmUuid);

    vmapi.post(vmapiPath, opts, function doActionCb(err, out, req_, res_) {
        if (err) {
            next(err);
            return;
        }

        if (params.action === 'finalize') {
            res.send(res_.statusCode);
            return;
        }

        if (!out.job_uuid) {
            next(new restify.InternalError(
                'Unable to execute "%s" migration action ' +
                '(req_id: %s)', params.action, req.getId()));
            return;
        }

        if (!out.migration) {
            next(new restify.InternalError(
                'Unexpected response trying to execute "%s" migration ' +
                'action (req_id: %s)', params.action, req.getId()));
            return;
        }

        req.log.debug({
            job_uuid: out.job_uuid,
            migration: out.migration,
            opts: opts
        }, 'VMAPI Migration job_uuid');

        res.send(201, translate(out.migration));
        next();
    });
}

function mount(server, before) {
    assert.object(server);
    assert.ok(before);

    server.get({
        path: '/:account/migrations',
        name: 'ListMigrations'
    }, before, list);

    server.get({
        path: '/:account/migrations/:machine',
        name: 'GetMigration'
    }, before, get);

    server.get({
        path: '/:account/machines/:machine/migrate',
        name: 'MigrateMachineEstimate'
    }, before, estimate);

    server.post({
        path: '/:account/machines/:machine/migrate',
        name: 'Migrate'
    }, before, watch, doAction);

    return server;
}



// --- Exports

module.exports = {
    mount: mount
};
