/*
 * Copyright 2014 Joyent, Inc. All rights reserved.
 *
 * We'd like to allow customers to add and remove NICs on their VMs. They can
 * do this by using POST, GET and HEAD on /:account/machines/:machine/nics and
 * /:account/machines/:machine/nics/:mac.
 *
 * First we check that the machine a NIC is associated with is owned by a user;
 * we don't want users futzing with other users' NICs. This is always done for
 * all handlers.
 *
 * After that we call the method to GET/HEAD a single NIC or list of NICs, or
 * POST the addition of a new NIC, or DELETE to remove a NIC from a VM.
 *
 * For GET/HEADs we access NAPI, the backend Network API, which indexes
 * networks, nics, nic tags, and IPs (although IPs aren't relevant here). For
 * POST or DELETE we need to call VMAPI, which handles mutations on VMs; VMAPI
 * updated NAPI behind the scenes after it completes the requested job.
 *
 * VMAPI tracks mutations using jobs. We're mainly concerned with jobs here
 * because they're asynchronous, ergo we need to poll VMAPI regularly to check
 * the status of a job (see pollJob() below) when adding or removing NICs. Jobs
 * can also fail.
 *
 * NICs are conceptually connected to networks through a nic_tag. A NIC has a
 * nic_tag which matches the nic_tag of the network it's connected to. This is
 * mainly used to check that the server a VM is on can connect to a network,
 * by checking that the GZ NICs contain those tags as well. Customers aren't
 * exposed to this, but it's relevant here when adding a NIC.
 *
 * Lastly, be aware that adding or removing a NIC from a VM causes that VM to
 * reboot as part of the process.
 */



var assert  = require('assert');
var backoff = require('backoff');
var restify = require('restify');
var vasync  = require('vasync');



// --- Globals



var InvalidArgumentError  = restify.InvalidArgumentError;
var MissingParameterError = restify.MissingParameterError;
var ResourceNotFoundError = restify.ResourceNotFoundError;
var InternalError = restify.InternalError;

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var MAC_RE  = /^[0-9a-f]{12}/i;



// --- Handlers



/*
 * Add a NIC to a VM.
 *
 * A network UUID is passed in as an argument, which we need to look up in NAPI
 * in order to find out the nic tag associated with that network. We then check
 * that there isn't already another NIC on that VM with that nic tag -- if there
 * is, we 302 redirect to that NIC. Then we create a VMAPI job to add a NIC to
 * the VM with that NIC tag, poll until the job succeeds or fails, then return
 * an appropriate response. For success it's JSON data about the NIC, otherwise
 * it's JSON detailing the error.
 *
 * Be aware that there is a race here -- while we check that a VM doesn't
 * already have a NIC with the same tag, there's a delay between the check and
 * the creation of the new NIC. This makes it possible for a user who calls
 * POST with the same details several times in a few seconds to end up with
 * multiple NICs on the VM, on the same network.
 */

function addNic(req, res, next) {
    assert.ok(req.sdc);

    var log         = req.log;
    var headers     = { 'x-request-id': req.getId() };
    var ownerUuid   = req.account.uuid;
    var vmUuid      = req.params.machine;
    var networkUuid = req.params.network;
    var login       = req.account.login;
    var origin      = req.params.origin || 'cloudapi';
    var context = {
        caller: req._auditCtx,
        params: req.params
    };

    if (!networkUuid) {
        return next(new MissingParameterError('network must be specified'));
    }

    if (typeof (networkUuid) !== 'string' || !networkUuid.match(UUID_RE)) {
        var msg = 'network argument has invalid format';
        return next(new InvalidArgumentError(msg));
    }

    var network, job;  // filled in by the vasync-called functions

    var getNetwork = function (_, cb) {
        req.sdc.napi.getNetwork(networkUuid, {
            log: log,
            headers: headers,
            params: { provisionable_by: ownerUuid }
        }, function (err, _network) {
            if (err) {
                return cb(err);
            }

            network = _network;
            log.debug(network, 'Network retrieved from NAPI');

            return cb();
        });
    };

    var checkNicDoesntExist = function (_, cb) {
        // XXX: preliminary check; jobs themselves need to atomically ensure
        // that VM doesn't have two nics on same network, because this check
        // here can race
        req.sdc.napi.listNics({
            belongs_to_uuid: vmUuid,
            belongs_to_type: 'zone',
            nic_tag: network.nic_tag
        }, {
            log: req.log,
            headers: { 'x-request-id': req.getId() }
        }, function (err, nics) {
            if (err) {
                return cb(err);
            }

            log.debug(nics, 'NICs retrieved from NAPI');

            if (nics.length > 1) {
                msg = 'VM has multiple NICs on that network';
                return cb(new InternalError(msg));
            }

            if (nics.length == 1) {
                var path = getNicPath(login, vmUuid, nics[0].mac);
                res.header('Location', path);
                res.send(302);
                return cb('done');
            }

            return cb();
        });
    };

    var addToNics = function (_, cb) {
        req.sdc.vmapi.addNics({
            uuid: vmUuid,
            creator_uuid: ownerUuid,
            networks: [network],
            origin: origin,
            context: context
        }, {
            log: log,
            headers: headers
        }, function (err, _job) {
            if (err) {
                return cb(err);
            }

            job = _job;
            log.debug(job, 'Job created to add NIC');

            return cb();
        });
    };

    var waitForJob = function (_, cb) {
        pollJob(req.sdc.vmapi, job.job_uuid, log, cb);
    };

    var writeResult = function (_, cb) {
        req.sdc.napi.listNics({
            belongs_to_uuid: vmUuid,
            belongs_to_type: 'zone',
            nic_tag: network.nic_tag
        }, {
            log: req.log,
            headers: { 'x-request-id': req.getId() }
        }, function (err, nics) {
            if (err) {
                return cb(err);
            }

            log.debug(nics, 'Fetched new NIC from NAPI');

            var nic = nics[0];
            delete nic.belongs_to_type;
            delete nic.belongs_to_uuid;

            var path = getNicPath(login, vmUuid, nic.mac);
            res.header('Location', path);
            res.send(201, nic);

            return cb();
        });
    };

    vasync.pipeline({
        'funcs': [
            getNetwork, checkNicDoesntExist, addToNics, waitForJob, writeResult
        ]
    }, function (err) {
        if (err === 'done') {
            return next();
        }

        return next(err); // err can be null too
    });

    return null;  // keep lint happy
}



/*
 * Remove a NIC from a VM.
 *
 * First we check NAPI that a NIC exists, based on its MAC address. If it
 * exists, we invoke a VMAPI job to remove it, poll on the job until it
 * completes, and then return the HTTP call.
 *
 * Much like addNic() above, this has a race condition. Unlike addNic() above,
 * this is only a minor problem, because several DELETEs in a row just ends
 * up successfully deleting the NIC, and several failed jobs.
 */

function removeNic(req, res, next) {
    assert.ok(req.sdc);

    var log       = req.log;
    var mac       = req.params.mac;
    var vmUuid    = req.params.machine;
    var origin    = req.params.origin || 'cloudapi';
    var ownerUuid = req.account.uuid;
    var headers   = { 'x-request-id': req.getId() };
    var context   = {
        caller: req._auditCtx,
        params: req.params
    };

    if (!mac.match(MAC_RE)) {
        return next(new InvalidArgumentError('mac has invalid format'));
    }

    var job;  // filled in by the vasync-called functions

    var checkNicExists = function (_, cb) {
        req.sdc.napi.getNic(mac, {
            log: log,
            headers: headers
        }, function (err, nic) {
            if (err) {
                return cb(err);
            }

            log.debug(nic, 'Fetched NIC from NAPI');

            if (nic.owner_uuid !== ownerUuid) {
                return cb(new ResourceNotFoundError('nic not found'));
            }

            return cb();
        });
    };

    var removeFromNics = function (_, cb) {
        // vmapi.removeNics takes macs with ':' separators, while we accept them
        // without the separators in the HTTP request. Ergo we must convert to
        // the seperated representation here
        mac = [0, 2, 4, 6, 8, 10].map(function (i) {
            return mac.slice(i, i + 2);
        }).join(':');

        req.sdc.vmapi.removeNics({
            uuid: vmUuid,
            creator_uuid: ownerUuid,
            macs: [mac],
            origin: origin,
            context: context
        }, {
            log: log,
            headers: headers
        }, function (err, _job) {
            if (err) {
                return cb(err);
            }

            job = _job;
            log.debug(job, 'Job created to remove NIC');

            return cb();
        });
    };

    var waitForJob = function (_, cb) {
        pollJob(req.sdc.vmapi, job.job_uuid, log, cb);
    };

    var writeResult = function (_, cb) {
        res.send(204);
        return cb();
    };

    vasync.pipeline({
        'funcs': [ checkNicExists, removeFromNics, waitForJob, writeResult ]
    }, next);

    return null;  // keep lint happy
}



/*
 * Fetch the JSON describing a NIC on a VM. We call NAPI for the details using
 * the NIC's MAC address, strip off some extraneous details from the result,
 * then feed it back to the HTTP caller.
 */

function getNic(req, res, next) {
    assert.ok(req.sdc);

    var log       = req.log;
    var mac       = req.params.mac;
    var ownerUuid = req.account.uuid;
    var headers   = { 'x-request-id': req.getId() };
    // XXX sdc.napi doesn't support origin or context

    if (!mac.match(MAC_RE)) {
        return next(new InvalidArgumentError('mac has invalid format'));
    }

    return req.sdc.napi.getNic(mac, {
        log: log,
        headers: headers
    }, function (err, nic) {
        if (err) {
            return next(err);
        }

        log.debug(nic, 'Get NIC from NAPI');

        if (nic.owner_uuid !== ownerUuid) {
            return next(new ResourceNotFoundError('nic not found'));
        }

        delete nic.belongs_to_type;
        delete nic.belongs_to_uuid;

        res.send(nic);
        return next();
    });
}



/*
 * Fetch a JSON array describing all NICs on a VM. We call NAPI for the details
 * of NICs on a VM, strip off seom extraneous details, then feed it back to the
 * HTTP caller.
 */

function listNics(req, res, next) {
    assert.ok(req.sdc);

    var log     = req.log;
    var vmUuid  = req.params.machine;
    var headers = { 'x-request-id': req.getId() };
    // XXX sdc.napi doesn't support origin or context

    return req.sdc.napi.listNics({
        belongs_to_uuid: vmUuid,
        belongs_to_type: 'zone'
    }, {
        log: log,
        headers: headers
    }, function (err, nics) {
        if (err) {
            return next(err);
        }

        nics.forEach(function (nic) {
            delete nic.belongs_to_type;
            delete nic.belongs_to_uuid;
        });

        // res.header('x-query-limit', opts.limit); // XXX
        res.header('x-resource-count', nics.length);
        res.send(nics);
        return next();
    });
}



// --- Helpers



/*
 * This is here solely to ensure that a VM actually belongs to the given
 * owner, since the NAPI calls can't make such a permission check on a VM.
 */

function checkMachine(req, res, next) {
    assert.ok(req.sdc);

    var vmUuid    = req.params.machine;
    var ownerUuid = req.account.uuid;

    req.log.debug({ vm: vmUuid, owner: ownerUuid }, 'Machine check for NICs');

    if (typeof (vmUuid) !== 'string' || !vmUuid.match(UUID_RE)) {
        return next(new InvalidArgumentError('VM has invalid format'));
    }

    // just playing safe
    if (!ownerUuid) {
        return next(new MissingParameterError('owner not found'));
    }

    return req.sdc.vmapi.getVm({
        uuid: vmUuid,
        owner_uuid: ownerUuid
    }, {
        log: req.log,
        headers: { 'x-request-id': req.getId() }
    }, next);
}



/*
 * Generate the canonical URL where the details for a NIC can be found.
 */

function getNicPath(login, vmUuid, mac) {
    mac = mac.replace(/\:/g, '');
    return '/' + [login, 'machines', vmUuid, 'nics', mac].join('/');
}



/*
 * Given a func, keep calling repeartedly with exponential backoff until it
 * succeeds, or we run out of tries. Then invoke the cb callback.
 */

function retry(func, cb) {
    var retryOpts = {
        minDelay: 200,
        maxDelay: 60 * 1000 // 60s
    };

    var call = backoff.call(func, null, cb);
    call.setStrategy(new backoff.ExponentialStrategy(retryOpts));
    call.failAfter(12);
    call.start();
}



/*
 * Given a job UUID, keep polling that job with exponential backoff until the
 * job changes status to succeess or failure. Invoke the cb callback on
 * completion.
 */

function pollJob(vmapi, jobUuid, log, cb) {
    var failedMsg;

    return retry(function (_, next) {
        return vmapi.getJob(jobUuid, function (err, job) {
            // XXX: on err, should we retry, or abort and 500?
            if (err) {
                return next(err);
            }

            log.debug(job, 'Polled job status');

            if (job.execution === 'succeeded') {
                return next();
            }

            if (job.execution === 'failed') {
                var last  = job.chain_results.slice(-1)[0];
                failedMsg = last.error.message;
                return next();
            }

            return next('Job has state ' + job.execution);
        });
    }, function (err) {
        if (err) {
            return cb(err);
        }

        if (failedMsg) {
            // Is returning an job error here a bad idea? It might
            // leak details we don't want.
            return cb(new InternalError(failedMsg));
        }

        return cb();
    });
}



/*
 * Add endpoints to cloudapi which customers can call.
 */

function mount(server, before, pre, post) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.post({
            path: '/:account/machines/:machine/nics',
            name: 'AddNic',
            version: ['7.1.0']
        },
        before,
        pre || [],
        checkMachine,
        addNic,
        post || []);

    server.get({
            path: '/:account/machines/:machine/nics',
            name: 'ListNics',
            version: ['7.1.0']
        },
        before,
        pre || [],
        checkMachine,
        listNics,
        post || []);

    server.head({
            path: '/:account/machines/:machine/nics',
            name: 'ListNics',
            version: ['7.1.0']
        },
        before,
        pre || [],
        checkMachine,
        listNics,
        post || []);

    server.get({
            path: '/:account/machines/:machine/nics/:mac',
            name: 'GetNic',
            version: ['7.1.0']
        },
        before,
        pre || [],
        checkMachine,
        getNic,
        post || []);

    server.head({
            path: '/:account/machines/:machine/nics/:mac',
            name: 'GetNic',
            version: ['7.1.0']
        },
        before,
        pre || [],
        checkMachine,
        getNic,
        post || []);

    server.del({
            path: '/:account/machines/:machine/nics/:mac',
            name: 'RemoveNic',
            version: ['7.1.0']
        },
        before,
        pre || [],
        checkMachine,
        removeNic,
        post || []);

    return server;
}



module.exports = {
    mount: mount
};
