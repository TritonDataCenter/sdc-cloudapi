/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
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
 * Note that for POST, a NIC needs to be created in NAPI first. Once the NIC is
 * created, its MAC is passed as an argument to VMAPI, which then creates the
 * vNIC on the VM.
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



var assert  = require('assert-plus');
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
 * in order to find out the nic tag associated with that network or network
 * pool. We then check that there isn't already another NIC on that VM with that
 * network -- if there is, we 302 redirect to that NIC. We also need to check
 * that the server has an appropriate nic tag, otherwise adding that network to
 * the VM will not work.
 *
 * Fabric networks are treated differently; instead of looking up the network
 * nic_tag in NAPI, we check the server's sysinfo for virtual network interfaces
 * which support that nic tag.
 *
 * Once those checks are performed, we create a NIC inside NAPI. The MAC of that
 * NIC is then passed to VMAPI, which creates a job to create the NIC on the VM
 * itself. We create the NIC in NAPI first to ensure that a caller can
 * immediately see the NIC appear with GET in cloudapi; they can check the state
 * of the NIC by looking at the 'state' attribute.
 *
 * Once the NIC has been sent off to VMAPI for creation, JSON data about the NIC
 * in NAPI is returned, as well as the Location header.
 *
 * Be aware that there is a race here -- while we check that a VM doesn't
 * already have a NIC with the same network, there's a delay between the check
 * and the creation of the new NIC. This makes it possible for a user who calls
 * POST with the same details several times in a few seconds to end up with
 * multiple NICs on the VM, on the same network.
 */

function addNic(req, res, next) {
    assert.ok(req.sdc);

    var log         = req.log;
    var headers     = { 'x-request-id': req.getId() };
    var vmUuid      = req.vm.uuid;
    var serverUuid  = req.vm.server_uuid;
    var ownerUuid   = req.account.uuid;
    var login       = req.account.login;
    var networkUuid = req.params.network;
    var origin      = req.params.origin || 'cloudapi';
    var context = {
        caller: req._auditCtx,
        params: req.params
    };

    if (!networkUuid) {
        return next(new MissingParameterError('network must be specified'));
    }

    if (typeof (networkUuid) !== 'string' || !networkUuid.match(UUID_RE)) {
        var errMsg = 'network argument has invalid format';
        return next(new InvalidArgumentError(errMsg));
    }

    var network, nic;  // filled in by the vasync-called functions

    function getNetworkPool(_, cb) {
        req.sdc.napi.getNetworkPool(networkUuid, {
            log: log,
            headers: headers
        }, function (err, networkPool) {
            if (err) {
                if (err.statusCode === 404) {
                    return cb();  // skip, since might be found by getNetwork()
                } else {
                    return cb(err);
                }
            }

            log.debug(networkPool, 'Network pool retrieved from NAPI');

            if (networkPool.owner_uuids &&
                networkPool.owner_uuids.indexOf(ownerUuid) === -1) {

                return cb(new InvalidArgumentError('network not found'));
            }

            network = networkPool;

            return cb();
        });
    }

    function getNetwork(_, cb) {
        // if getNetworkPool already populated 'network', skip this function
        if (network) {
            return cb();
        }

        return req.sdc.napi.getNetwork(networkUuid, {
            log: log,
            headers: headers,
            params: { provisionable_by: ownerUuid }
        }, function (err, _network) {
            if (err) {
                if (err.statusCode === 404) {
                    return cb(new InvalidArgumentError('network not found'));
                } else {
                    return cb(err);
                }
            }

            network = _network;
            log.debug(network, 'Network retrieved from NAPI');

            return cb();
        });
    }

    function checkNicDoesntExist(_, cb) {
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

            log.debug(nics, 'VM NICs retrieved from NAPI');

            var networkNics = nics.filter(function (n) {
                return n.network_uuid === networkUuid;
            });

            if (networkNics.length > 1) {
                var msg = 'VM has multiple NICs on that network';
                return cb(new InternalError(msg));
            }

            if (networkNics.length === 1) {
                var path = getNicPath(login, vmUuid, networkNics[0].mac);
                res.header('Location', path);
                res.send(302);
                return cb('done');
            }

            return cb();
        });
    }

    function checkServerHasTag(_, cb) {
        var func = network.fabric ?
            checkServerHasOverlayTag :
            checkServerHasRegularTag;
        func(_, cb);
    }

    function checkServerHasOverlayTag(_, cb) {
        req.sdc.cnapi.getServer(serverUuid, {
            extras: 'sysinfo'
        }, function (err, server) {
            if (err) {
                return cb(err);
            }

            var sysinfo = server.sysinfo;
            assert.ok(sysinfo);

            var virtInterfaces = sysinfo['Virtual Network Interfaces'];

            if (!virtInterfaces) {
                var msg = 'Server does not support that network';
                return cb(new InvalidArgumentError(msg));
            }

            var tags = Object.keys(virtInterfaces).map(function (ifaceName) {
                return virtInterfaces[ifaceName]['Overlay Nic Tags'];
            }).filter(function (overlays) {
                return overlays;
            });

            tags = [].concat.apply([], tags); // flatten

            if (tags.indexOf(network.nic_tag) === -1) {
                msg = 'Server does not support that network';
                return cb(new InvalidArgumentError(msg));
            }

            return cb();
        });
    }

    function checkServerHasRegularTag(_, cb) {
        req.sdc.napi.listNics({
            belongs_to_uuid: serverUuid,
            belongs_to_type: 'server',
            nic_tags_provided: network.nic_tag
        }, {
            log: req.log,
            headers: { 'x-request-id': req.getId() }
        }, function (err, nics) {
            if (err) {
                return cb(err);
            }

            log.debug(nics, 'Server NICs retrieved from NAPI');

            if (nics.length > 0) {
                return cb();
            }

            return req.sdc.napi.listAggrs({
                belongs_to_uuid: serverUuid,
                nic_tags_provided: network.nic_tag
            }, {
                log: req.log,
                headers: { 'x-request-id': req.getId() }
            }, function (err2, aggrs) {
                if (err2) {
                    return cb(err2);
                }

                log.debug(aggrs, 'Server aggregations retrieved from NAPI');

                if (aggrs.length === 0) {
                    var msg = 'Server does not support that network';
                    return cb(new InvalidArgumentError(msg));
                }

                return cb();
            });
        });
    }

    function addToNapi(_, cb) {
        req.sdc.napi.provisionNic(network.uuid, {
            belongs_to_uuid: vmUuid,
            belongs_to_type: 'zone',
            cn_uuid: serverUuid,
            owner_uuid: ownerUuid,
            state: 'provisioning',
            origin: origin,
            context: context
        }, {
            log: log,
            headers: headers
        }, function (err, _nic) {
            if (err) {
                return cb(err);
            }

            nic = _nic;
            log.debug(nic, 'Added NIC to NAPI');

            return cb();
        });
    }

    // if the addToVm() call below failed, we need to clean up the NIC in NAPI
    function removeFromNapi(cb) {
        if (!nic) {
            return cb();
        }

        log.debug(nic, 'Cleaning up NIC in NAPI due to VMAPI call failure');

        return req.sdc.napi.deleteNic(nic.mac, {
            origin: origin,
            context: context
        }, {
            log: log,
            headers: headers
        }, function (err) {
            if (err) {
                return cb(err);
            }

            log.debug(nic, 'Cleaned up NIC in NAPI');

            return cb();
        });
    }

    function addToVm(_, cb) {
        req.sdc.vmapi.addNics({
            uuid: vmUuid,
            creator_uuid: ownerUuid,
            macs: [nic.mac],
            origin: origin,
            context: context
        }, {
            log: log,
            headers: headers
        }, function (err, job) {
            if (err) {
                return cb(err);
            }

            log.debug(job, 'Job created to add NIC to VM');

            return cb();
        });
    }

    function writeResult(_, cb) {
        nic = formatNic(nic);
        var path = getNicPath(login, vmUuid, nic.mac);
        res.header('Location', path);
        res.send(201, nic);

        return cb();
    }

    return vasync.pipeline({
        'funcs': [
            getNetworkPool, getNetwork, checkNicDoesntExist, checkServerHasTag,
            addToNapi, addToVm, writeResult
        ]
    }, function (err) {
        if (!err || err === 'done') {
            return next();
        }

        // clean up any stale NIC in NAPI, if present
        return removeFromNapi(function (err2) {
            if (err2) {
                log.debug(err2, 'Error removing NAPI-only NIC from NAPI');
            }

            // the earlier err takes priority over err2 for informing the user
            return next(err); // err can be null too
        });
    });
}



/*
 * Remove a NIC from a VM.
 *
 * First we check NAPI that a NIC exists, based on its MAC address. If it
 * exists, we invoke a VMAPI job to remove it and then return the HTTP call.
 *
 * Much like addNic() above, this has a race condition. Unlike addNic() above,
 * this is only a minor problem, because several DELETEs in a row just ends
 * up successfully deleting the NIC, and several failed jobs.
 */

function removeNic(req, res, next) {
    assert.ok(req.sdc);

    var log       = req.log;
    var vmUuid    = req.vm.uuid;
    var mac       = req.params.mac;
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

    function checkNicExists(_, cb) {
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
    }

    function removeFromNics(_, cb) {
        // vmapi.removeNics takes macs with ':' separators, while we accept them
        // without the separators in the HTTP request. Ergo we must convert to
        // the separated representation here.
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
    }

    function writeResult(_, cb) {
        res.send(204);
        return cb();
    }

    return vasync.pipeline({
        'funcs': [ checkNicExists, removeFromNics, writeResult ]
    }, next);
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

        nic = formatNic(nic);

        res.send(nic);
        return next();
    });
}



/*
 * Fetch a JSON array describing all NICs on a VM. We call NAPI for the details
 * of NICs on a VM, strip off some extraneous details, then feed it back to the
 * HTTP caller.
 */

function listNics(req, res, next) {
    assert.ok(req.sdc);

    var log     = req.log;
    var vmUuid  = req.vm.uuid;
    var headers = { 'x-request-id': req.getId() };

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

        nics = nics.map(formatNic);

        // res.header('x-query-limit', opts.limit); // XXX
        res.header('x-resource-count', nics.length);
        res.send(nics);
        return next();
    });
}



// --- Helpers



/*
 * This is here primarily to ensure that a VM actually belongs to the given
 * owner, since the NAPI calls can't make such a permission check on a VM.
 */

function getMachine(req, res, next) {
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
    }, function (err, vm) {
        if (err) {
            return next(err);
        }

        req.vm = vm;

        return next();
    });
}



/*
 * Generate the canonical URL where the details for a NIC can be found.
 */

function getNicPath(login, vmUuid, mac) {
    mac = mac.replace(/\:/g, '');
    return '/' + [login, 'machines', vmUuid, 'nics', mac].join('/');
}



/*
 * Only some of the attributes from NAPI are desirable, the rest being internal.
 * We only want to expose some of them to the public, which this function does.
 * It also protects against future NAPI attribyte additions.
 *
 * All NICs to the outside world should be run through this function.
 */

function formatNic(nic) {
    return {
        mac:     nic.mac,
        ip:      nic.ip,
        primary: nic.primary,
        gateway: nic.gateway,
        netmask: nic.netmask,
        state:   nic.state,
        network: nic.network_uuid
    };
}



/*
 * Add endpoints to cloudapi which customers can call.
 */

function mount(server, before, pre, post) {
    assert.object(server);
    assert.ok(before);

    server.post({
            path: '/:account/machines/:machine/nics',
            name: 'AddNic',
            version: ['7.2.0', '7.3.0', '8.0.0']
        },
        before,
        pre || [],
        getMachine,
        addNic,
        post || []);

    server.get({
            path: '/:account/machines/:machine/nics',
            name: 'ListNics',
            version: ['7.2.0', '7.3.0', '8.0.0']
        },
        before,
        pre || [],
        getMachine,
        listNics,
        post || []);

    server.head({
            path: '/:account/machines/:machine/nics',
            name: 'ListNics',
            version: ['7.2.0', '7.3.0', '8.0.0']
        },
        before,
        pre || [],
        getMachine,
        listNics,
        post || []);

    server.get({
            path: '/:account/machines/:machine/nics/:mac',
            name: 'GetNic',
            version: ['7.2.0', '7.3.0', '8.0.0']
        },
        before,
        pre || [],
        getMachine,
        getNic,
        post || []);

    server.head({
            path: '/:account/machines/:machine/nics/:mac',
            name: 'GetNic',
            version: ['7.2.0', '7.3.0', '8.0.0']
        },
        before,
        pre || [],
        getMachine,
        getNic,
        post || []);

    server.del({
            path: '/:account/machines/:machine/nics/:mac',
            name: 'RemoveNic',
            version: ['7.2.0', '7.3.0', '8.0.0']
        },
        before,
        pre || [],
        getMachine,
        removeNic,
        post || []);

    return server;
}



module.exports = {
    mount: mount
};
