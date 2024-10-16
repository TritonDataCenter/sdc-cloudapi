/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 * Copyright 2024 MNX Cloud, Inc.
 */

/*
 * These endpoints allow the creation/listing/resizing/deletion of disks on
 * bhyve VMs.
 */

var util = require('util'),
    format = util.format;

var assert = require('assert-plus');
var restify = require('restify');
var string2uuid = require('uuid-by-string');

// --- Globals



var InvalidArgumentError = restify.InvalidArgumentError;
var MissingParameterError = restify.MissingParameterError;
var ResourceNotFoundError = restify.ResourceNotFoundError;

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var PCI_SLOT_RE = /^[0-9]{1,3}:[0-9]{1,2}:[0-7]$/;
var MAX_ALLOWED_VM_DISKS = 8;


// --- Handlers



/*
 * Given a size in MiB and PCI slot, kick off a disk-creation job to add a new
 * disk to a VM.
 */
function createDisk(req, res, next) {
    assert.ok(req.sdc);

    var log = req.log;
    var headers = { 'x-request-id': req.getId() };
    var context = { caller: req._auditCtx };
    var origin = req.params.origin || 'cloudapi';
    var vmUuid = req.vm.uuid;
    var ownerUuid = req.account.uuid;
    var size = req.params.size;
    var pciSlot = req.params.pci_slot;

    req.vm.disks = req.vm.disks || [];

    if (req.vm.brand !== 'bhyve') {
        next(InvalidArgumentError('Disk Creation is supported only for ' +
            'BHYVE VMs'));
        return;
    }

    if (req.vm.state !== 'stopped') {
        next(new InvalidArgumentError('VM must be stopped'));
        return;
    }

    if (!size) {
        next(new MissingParameterError('size must be specified'));
        return;
    }

    if (size !== 'remaining' && isNaN(+size)) {
        next(new InvalidArgumentError('size must be a number'));
        return;
    }

    if (pciSlot !== undefined && !PCI_SLOT_RE.test(pciSlot)) {
        next(new InvalidArgumentError('pci_slot has wrong format'));
        return;
    }

    if (req.vm.disks.length >= MAX_ALLOWED_VM_DISKS) {
        next(new InvalidArgumentError('A maximum of ' + MAX_ALLOWED_VM_DISKS +
            ' disks per VM are supported'));
        return;
    }

    if (pciSlot) {
        var diskId = getDiskUuid(vmUuid, pciSlot);
    }

    if (size === 'remaining') {
        if (!req.vm.flexible_disk_size) {
            next(new InvalidArgumentError('remaining is only supported for ' +
                'VMs created with flexible_disk_size packages'));
            return;
        }

        var disksSum = req.vm.disks.reduce(function sumDisk(sum, disk) {
            return (sum + Number(disk.size) || 0);
        }, 0);
        size = req.vm.flexible_disk_size - disksSum;
    }

    req.sdc.vmapi.createDisk({
        uuid: vmUuid,
        owner_uuid: ownerUuid,
        disk_uuid: diskId,
        pci_slot: pciSlot,
        size: size,
        origin: origin,
        context: context
    }, {
        log: log,
        headers: headers
    }, function createDiskCb(err, job) {
        if (err) {
            next(err);
            return;
        }

        var login = req.account.login;
        log.debug({
            request: format('POST /%s/machines/%s/disks -> ok', login, vmUuid),
            job: job
        });

        if (!pciSlot) {
            res.send(202);
            next();
            return;
        }

        var location = '/' + login + '/machines/' + vmUuid + '/disks/' + diskId;
        res.header('Location', location);

        var disk = {
            uuid: diskId,
            pci_slot: pciSlot,
            size: size,
            boot: false,
            state: 'creating'
        };

        res.send(translate(disk));

        next();
    });
}



/*
 * Resize a VM's disk by starting a resize job. Resizing down will only be
 * allowed if dangerous_allow_shrink is set, since shrinking a disk will likely
 * lead to corruption and data loss within the disk when it is truncated.
 */
function resizeDisk(req, res, next) {
    assert.ok(req.sdc);

    var log = req.log;
    var headers = { 'x-request-id': req.getId() };
    var context = { caller: req._auditCtx };
    var origin = req.params.origin || 'cloudapi';
    var vmUuid = req.vm.uuid;
    var ownerUuid = req.account.uuid;
    var size = req.params.size;
    var canShrink = req.params.dangerous_allow_shrink;

    if (req.vm.state !== 'stopped') {
        next(new InvalidArgumentError('VM must be stopped'));
        return;
    }

    if (!size) {
        next(new MissingParameterError('size must be specified'));
        return;
    }

    if (isNaN(+size)) {
        next(new InvalidArgumentError('size must be a number'));
        return;
    }

    var shrinkType = typeof (canShrink);
    if (shrinkType !== 'undefined' && shrinkType !== 'boolean') {
        var errMsg = 'dangerous_allow_shrink must be a boolean';
        next(new InvalidArgumentError(errMsg));
        return;
    }

    req.sdc.vmapi.resizeDisk({
        uuid: vmUuid,
        owner_uuid: ownerUuid,
        pci_slot: req.disk.pci_slot,
        size: size,
        dangerous_allow_shrink: canShrink,
        origin: origin,
        context: context
    }, {
        log: log,
        headers: headers
    }, function resizeDiskCb(err, job) {
        if (err) {
            next(err);
            return;
        }


        log.debug({
            request: format('POST /%s/machines/%s/disks/%s -> ok',
                req.account.login, vmUuid, req.disk.uuid),
            job: job
        });

        req.disk.state = 'resizing';

        res.send(translate(req.disk));
        next();
    });
}



/*
 * Delete a disk from a VM by starting a deletion job.
 */
function deleteDisk(req, res, next) {
    assert.ok(req.sdc);

    var log = req.log;
    var headers = { 'x-request-id': req.getId() };
    var context = { caller: req._auditCtx };
    var origin = req.params.origin || 'cloudapi';
    var vmUuid = req.vm.uuid;
    var ownerUuid = req.account.uuid;

    if (req.vm.state !== 'stopped') {
        next(new InvalidArgumentError('VM must be stopped'));
        return;
    }

    req.sdc.vmapi.deleteDisk({
        uuid: vmUuid,
        owner_uuid: ownerUuid,
        pci_slot: req.disk.pci_slot,
        origin: origin,
        context: context
    }, {
        log: log,
        headers: headers
    }, function deleteDiskCb(err, job) {
        if (err) {
            next(err);
            return;
        }

        log.debug({
            request: format('DELETE /%s/machines/%s/disks/%s -> ok',
                req.account.login, vmUuid, req.disk.uuid),
            job: job
        });

        res.send(204);
        next();
    });
}



/*
 * Return a single specific disk object. In order for consumers to have a
 * more accurate idea about the state of the disk (e.g. resizing), we fake
 * a disk state by drawing from the current VM's state and any queued or running
 * disk jobs for this VM.
 */
function getDisk(req, res, next) {
    loadDiskJobs(req, function jobCb(err, jobs) {
        if (err) {
            next(err);
            return;
        }

        var disk = req.disk;

        for (var i = 0; i !== jobs.length; i++) {
            var job = jobs[i];
            if (disk.path === job.path) {
                disk.state = job.task;
                break;
            }
        }

        disk.state = disk.state || req.vm.state;

        res.send(translate(disk));
        next();
    });
}



/*
 * Return a list of disk object for a given VM. In order for consumers to have a
 * more accurate idea about the state of the disks (e.g. resizing), we fake
 * disk states by drawing from the current VM's state and any queued or running
 * disk jobs for this VM and disk.
 */
function listDisks(req, res, next) {
    var vmUuid = req.vm.uuid;
    var disks = req.vm.disks || [];

    if (disks.length === 0) {
        res.header('x-resource-count', disks.length);
        res.send(disks);
        next();
        return;
    }

    loadDiskJobs(req, function jobCb(err, jobs) {
        if (err) {
            next(err);
            return;
        }

        // since create jobs have no path, they're ignored here
        disks.forEach(function addDiskStatus(disk) {
            for (var i = 0; i !== jobs.length; i++) {
                var job = jobs[i];
                if (job.path === disk.path) {
                    disk.state = job.task;
                    return;
                }
            }

            disk.state = disk.state || req.vm.state;
            disk.uuid = disk.uuid || getDiskUuid(vmUuid, disk.pci_slot);
        });

        // and here we add faux disk objects for disks currently being created
        // which have a pci_slot
        jobs.forEach(function addDiskObject(job) {
            if (job.task !== 'creating' || !job.pci_slot) {
                return;
            }

            var existing = disks.filter(function checkSlotPresent(disk) {
                return disk.pci_slot === job.pci_slot;
            })[0];

            if (!existing) {
                disks.push({
                    uuid: getDiskUuid(vmUuid, job.pci_slot),
                    pci_slot: job.pci_slot,
                    size: job.size,
                    boot: false,
                    state: job.task
                });
            }
        });

        res.header('x-resource-count', disks.length);
        res.send(disks.map(translate));
        next();
    });
}



// --- Helpers



/*
 * Find the VM associated with the machine param (and current account). Assign
 * to req.vm.
 */
function getMachine(req, res, next) {
    assert.ok(req.sdc);

    var vmUuid = req.params.machine;
    var ownerUuid = req.account.uuid;
    assert.ok(ownerUuid, 'ownerUuid');

    req.log.debug({ vm: vmUuid, owner: ownerUuid }, 'Machine check for disks');

    if (!UUID_RE.test(vmUuid)) {
        next(new InvalidArgumentError('VM has invalid format'));
        return;
    }

    req.sdc.vmapi.getVm({
        uuid: vmUuid,
        owner_uuid: ownerUuid
    }, {
        log: req.log,
        headers: { 'x-request-id': req.getId() }
    }, function getVmCb(err, vm) {
        if (err) {
            next(err);
            return;
        }

        req.vm = vm;

        next();
    });
}



/*
 * Given a :disk param, find the associated disk in req.vm.disks.
 *
 * If a disk has no UUID, we generate a stable one on the fly. If the disk
 * already has a UUID (i.e. vmadm has one stored), we use that instead.
 */
function getMachineDisk(req, res, next) {
    var id = req.params.disk;
    var vm = req.vm;

    var disks = (vm.disks || []).filter(function matchUuid(disk) {
        return disk.uuid === id || getDiskUuid(vm.uuid, disk.pci_slot) === id;
    });

    req.disk = disks[0];

    if (!req.disk) {
        next(new ResourceNotFoundError('disk not found'));
        return;
    }

    req.disk.uuid = req.disk.uuid || id;

    next();
}



/*
 * Convert a disk object into the representation used by clients.
 */
function translate(disk) {
    return {
        id: disk.uuid,
        pci_slot: disk.pci_slot,
        size: disk.size,
        block_size: disk.block_size,
        boot: disk.boot || false,
        state: disk.state
    };
}



/*
 * Fetch any queued or running disk jobs for resize or deletion. Return a
 * simplified representation of the job type and associated path.
 */
function loadDiskJobs(req, cb) {
    req.sdc.vmapi.listJobs({
        vm_uuid: req.vm.uuid,
        task: 'update',
        execution: 'queued'
    }, {
        headers: {
            'x-request-id': req.getId()
        }
    }, function loadQueuedJobsCb(err, queuedJobs) {
        if (err) {
            cb(err);
            return;
        }

        req.sdc.vmapi.listJobs({
            vm_uuid: req.vm.uuid,
            task: 'update',
            execution: 'running'
        }, {
            headers: {
                'x-request-id': req.getId()
            }
        }, function loadRunningJobsCb(err2, runningJobs) {
            if (err2) {
                cb(err2);
                return;
            }

            var jobs = queuedJobs.concat(runningJobs);
            var subtasks = ['create_disk', 'resize_disk', 'delete_disk'];

            var subtaskJobs = jobs.filter(function matchSubtask(job) {
                return subtasks.indexOf(job.params.subtask) !== -1;
            });

            var simplifiedJobs = subtaskJobs.map(function simplify(job) {
                var payload = job.params.payload;
                var task = job.params.subtask;
                var sJobs;

                if (task === 'create_disk') {
                    sJobs = payload.add_disks.map(function createJob(disk) {
                        return {
                            pci_slot: disk.pci_slot,
                            size: disk.size,
                            task: 'creating'
                        };
                    });
                } else if (task === 'resize_disk') {
                    sJobs = payload.update_disks.map(function resizeJob(disk) {
                        return {
                            path: disk.path,
                            task: 'resizing'
                        };
                    });
                } else if (task === 'delete_disk') {
                    sJobs = payload.remove_disks.map(function deleteJob(path) {
                        return {
                            path: path,
                            task: 'deleting'
                        };
                    });
                } else {
                    assert.ok(false, 'unexpected value');
                }

                return sJobs;
            });

            var flattenedJobs = [].concat.apply([], simplifiedJobs);

            cb(null, flattenedJobs);
        });
    });
}



/*
 * We generate an apparently-persistent UUID for each disk based on the VM's
 * UUID and the PCI slot, since these two attributes don't change. Although
 * we don't store the UUID, since VM UUID and PCI slot don't change, the
 * resulting UUID for a specific disk is always the same.
 */
function getDiskUuid(vmUuid, pciSlot) {
    return string2uuid(vmUuid + '/' + pciSlot).toLowerCase();
}



/*
 * Add endpoints to cloudapi which customers can call.
 */
function mount(server, before, pre, post) {
    assert.object(server);
    assert.ok(before);

    server.post({
            path: '/:account/machines/:machine/disks',
            name: 'CreateMachineDisk',
            version: ['7.2.0', '7.3.0', '8.0.0', '9.0.0']
        },
        before,
        pre || [],
        getMachine,
        createDisk,
        post || []);

    server.get({
            path: '/:account/machines/:machine/disks',
            name: 'ListMachineDisks',
            version: ['7.2.0', '7.3.0', '8.0.0', '9.0.0']
        },
        before,
        pre || [],
        getMachine,
        listDisks,
        post || []);

    server.head({
            path: '/:account/machines/:machine/disks',
            name: 'ListMachineDisks',
            version: ['7.2.0', '7.3.0', '8.0.0', '9.0.0']
        },
        before,
        pre || [],
        getMachine,
        listDisks,
        post || []);

    server.get({
            path: '/:account/machines/:machine/disks/:disk',
            name: 'GetMachineDisk',
            version: ['7.2.0', '7.3.0', '8.0.0', '9.0.0']
        },
        before,
        pre || [],
        getMachine,
        getMachineDisk,
        getDisk,
        post || []);

    server.head({
            path: '/:account/machines/:machine/disks/:disk',
            name: 'GetMachineDisk',
            version: ['7.2.0', '7.3.0', '8.0.0', '9.0.0']
        },
        before,
        pre || [],
        getMachine,
        getMachineDisk,
        getDisk,
        post || []);

    server.post({
            path: '/:account/machines/:machine/disks/:disk',
            name: 'ResizeMachineDisk',
            version: ['7.2.0', '7.3.0', '8.0.0', '9.0.0']
        },
        before,
        pre || [],
        getMachine,
        getMachineDisk,
        resizeDisk,
        post || []);


    server.del({
            path: '/:account/machines/:machine/disks/:disk',
            name: 'DeleteMachineDisk',
            version: ['7.2.0', '7.3.0', '8.0.0', '9.0.0']
        },
        before,
        pre || [],
        getMachine,
        getMachineDisk,
        deleteDisk,
        post || []);

    return server;
}



module.exports = {
    mount: mount
};
