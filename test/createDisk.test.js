/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2026 Edgecast Cloud LLC.
 */

/*
 * Unit tests for the CreateMachineDisk handler. These need no live datacenter:
 * the VM is supplied directly and vmapi.createDisk() is stubbed.
 */

var test = require('tape');

var createDisk = require('../lib/endpoints/disks')._createDisk;

// --- Globals

var IMAGE_UUID = 'ede15ae3-a2ed-4636-a4d5-c130cbd9c297';
var OWNER_UUID = '7b315468-c6be-46dc-b99b-9c1f59224693';
var VM_UUID = '3fdfbfe8-1c98-4d0e-b95b-1a4d5f8b7d3a';
var LOGIN = 'bob';

// --- Helpers

/*
 * An image-backed bhyve boot disk as vmadm actually reports it. block_size is
 * read back from the zvol's volblocksize, so it is always present, including
 * alongside image_uuid. See TritonDataCenter/sdc-cloudapi#156.
 */
function bootDisk() {
    return {
        boot: true,
        block_size: 8192,
        image_uuid: IMAGE_UUID,
        pci_slot: '0:4:0',
        size: 10240
    };
}

function mkReq(opts) {
    var created = [];

    return {
        created: created,
        req: {
            _auditCtx: { caller: LOGIN },
            account: { login: LOGIN, uuid: OWNER_UUID },
            getId: function getId() { return 'test-request-id'; },
            log: { debug: function debug() {} },
            params: opts.params,
            sdc: {
                vmapi: {
                    createDisk: function stubCreateDisk(params, _opts, cb) {
                        created.push(params);
                        setImmediate(cb, null, { job_uuid: 'test-job' });
                    }
                }
            },
            vm: opts.vm
        }
    };
}

function mkRes() {
    var res = { headers: {} };

    res.header = function header(name, value) {
        res.headers[name] = value;
    };

    res.send = function send(body) {
        res.body = body;
    };

    return res;
}

function stoppedBhyveVm(disks) {
    return {
        brand: 'bhyve',
        disks: disks,
        flexible_disk_size: 102400,
        state: 'stopped',
        uuid: VM_UUID
    };
}

// --- Tests

/*
 * The regression from TRITON-2459: createDisk validated the VM's persisted
 * disks rather than the requested one, so every image-backed bhyve boot disk
 * tripped the "Cannot set block_size and image_uuid" check. The throw was
 * synchronous, so it escaped to cloudapi's uncaughtException handler and the
 * caller saw a 500 InternalError.
 */
test('CreateMachineDisk accepts a VM with an image-backed boot disk',
    function (t) {
    var ctx = mkReq({
        params: { pci_slot: '0:4:4', size: 20480 },
        vm: stoppedBhyveVm([
            bootDisk(),
            { block_size: 4096, pci_slot: '0:4:1', size: 10240 }
        ])
    });
    var res = mkRes();

    createDisk(ctx.req, res, function next(err) {
        t.ifError(err, 'err');

        t.equal(ctx.created.length, 1, 'vmapi.createDisk() called once');

        var args = ctx.created[0];
        t.equal(args.uuid, VM_UUID, 'vm uuid');
        t.equal(args.owner_uuid, OWNER_UUID, 'owner uuid');
        t.equal(args.pci_slot, '0:4:4', 'pci_slot');
        t.equal(args.size, 20480, 'size');
        t.equal(args.origin, 'cloudapi', 'origin');
        t.ok(!args.hasOwnProperty('block_size'),
            'block_size not sent to vmapi');

        t.ok(res.body, 'response body');
        t.equal(res.body.pci_slot, '0:4:4', 'response pci_slot');
        t.equal(res.body.size, 20480, 'response size');
        t.equal(res.body.state, 'creating', 'response state');
        t.equal(res.body.boot, false, 'response boot');
        t.equal(res.headers.Location,
            '/' + LOGIN + '/machines/' + VM_UUID + '/disks/' + res.body.id,
            'Location header');

        t.end();
    });
});


/*
 * block_size on an existing disk describes the zvol as it already is. Whether
 * it is a value cloudapi would accept on a create request is irrelevant here,
 * and must not block adding an unrelated disk.
 */
test('CreateMachineDisk does not validate existing disks', function (t) {
    var ctx = mkReq({
        params: { pci_slot: '0:4:4', size: 20480 },
        vm: stoppedBhyveVm([{ block_size: 1234, pci_slot: '0:4:0',
            size: 10240 }])
    });

    createDisk(ctx.req, mkRes(), function next(err) {
        t.ifError(err, 'err');
        t.equal(ctx.created.length, 1, 'vmapi.createDisk() called once');
        t.end();
    });
});


test('CreateMachineDisk with size "remaining"', function (t) {
    var ctx = mkReq({
        params: { pci_slot: '0:4:4', size: 'remaining' },
        vm: stoppedBhyveVm([bootDisk(), { pci_slot: '0:4:1', size: 512 }])
    });

    createDisk(ctx.req, mkRes(), function next(err) {
        t.ifError(err, 'err');
        t.equal(ctx.created[0].size, 102400 - 10240 - 512, 'remaining size');
        t.end();
    });
});


test('CreateMachineDisk without pci_slot returns 202', function (t) {
    var ctx = mkReq({
        params: { size: 20480 },
        vm: stoppedBhyveVm([bootDisk()])
    });
    var res = mkRes();

    createDisk(ctx.req, res, function next(err) {
        t.ifError(err, 'err');
        t.equal(ctx.created.length, 1, 'vmapi.createDisk() called once');
        t.equal(res.body, 202, 'status 202');
        t.end();
    });
});


test('CreateMachineDisk rejects non-bhyve VMs', function (t) {
    var ctx = mkReq({
        params: { pci_slot: '0:4:4', size: 20480 },
        vm: { brand: 'joyent', disks: [], state: 'stopped', uuid: VM_UUID }
    });

    createDisk(ctx.req, mkRes(), function next(err) {
        t.ok(err, 'err');
        t.equal(err.body.code, 'InvalidArgument', 'err code');
        t.equal(ctx.created.length, 0, 'vmapi.createDisk() not called');
        t.end();
    });
});


test('CreateMachineDisk rejects a running VM', function (t) {
    var vm = stoppedBhyveVm([bootDisk()]);
    vm.state = 'running';

    var ctx = mkReq({
        params: { pci_slot: '0:4:4', size: 20480 },
        vm: vm
    });

    createDisk(ctx.req, mkRes(), function next(err) {
        t.ok(err, 'err');
        t.equal(err.body.code, 'InvalidArgument', 'err code');
        t.equal(ctx.created.length, 0, 'vmapi.createDisk() not called');
        t.end();
    });
});
