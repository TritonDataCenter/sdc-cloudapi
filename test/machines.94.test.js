/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

var test = require('@smaller/tap').test;
var util = require('util');
var vasync = require('vasync');

var common = require('./common');
var machinesCommon = require('./machines/common');
var checkMachine = machinesCommon.checkMachine;
var deleteMachine = require('./machines/delete');

var BHYVE_128 = Object.assign({}, common.bhyve_128_package, {
    quota: 15360
});

var BHYVE_128_INFLEXIBLE = Object.assign({}, BHYVE_128, {
    uuid: '48653cc1-e9a2-448f-a245-b361c8c5a6f9',
    name: 'sdc_128_bhyve_inflexible',
    flexible_disk: false
});

var BHYVE_128_FLEXIBLE = Object.assign({}, BHYVE_128, {
    uuid: '1db47fe9-a06b-439a-ac21-bffeb1b44b83',
    name: 'sdc_128_bhyve_flex',
    flexible_disk: true
});

var BHYVE_128_FLEXIBLE_DISKS = Object.assign({}, BHYVE_128_FLEXIBLE, {
    uuid: '7296b6bf-a1bd-4c5a-aa01-ef7f9a26d103',
    name: 'sdc_128_bhyve_flex_disks',
    disks: [
        {},
        {size: 512}
    ]
});

var BHYVE_128_FLEXIBLE_REMAINING = Object.assign({}, BHYVE_128_FLEXIBLE, {
    uuid: '3b71c830-ae07-4c38-a035-8f6882455954',
    name: 'sdc_128_bhyve_flex_remaining',
    disks: [
        { size: 'remaining' }
    ]
});

var CUSTOM_BHYVE_PACKAGES = [
    BHYVE_128_FLEXIBLE,
    BHYVE_128_FLEXIBLE_DISKS,
    BHYVE_128_INFLEXIBLE,
    BHYVE_128_FLEXIBLE_REMAINING
];

var BHYVE_IMAGE;
var BHYVE_IMAGE_UUID;
var BHYVE_MACHINE_UUID;
var DISK_UUID;
var CLIENT;
var CLIENTS;
var OTHER;
var SERVER;

function checkDisk(t, expectedDisk, actualDisk) {
    Object.keys(expectedDisk).forEach(function check(prop) {
        t.strictEqual(expectedDisk[prop], actualDisk[prop]);
    });
}

function checkDisks(t, expectedDisks, actualDisks) {
    expectedDisks.forEach(function check(disk, idx) {
        checkDisk(t, disk, actualDisks[idx]);
    });
}

function checkDisksQuota(t, disks, quota) {
    var disksSum = disks.reduce(function sumDisk(sum, disk) {
        return sum + disk.size;
    }, 0);

    t.strictEqual(disksSum, quota);
}

test('setup', function (t) {
    common.setup({clientApiVersion: '~9.0'},
        function onSetup(_, clients, server) {
        CLIENTS = clients;
        CLIENT = clients.user;
        OTHER = clients.other;
        SERVER = server;

        t.end();
    });
});

test('get bhyve image', function (t) {
    // Make sure we're not getting an lx-branded image instead
    // of a KVM/bhyve one.
    CLIENT.get('/my/images?os=linux', function (err, req, res, body) {
        t.ifError(err, 'GET /my/images error');
        t.equal(res.statusCode, 200, 'GET /my/images status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/images body');
        t.ok(Array.isArray(body), 'GET /my/images body is an array');
        // Do nothing if we haven't got a Linux image already imported
        if (body.length === 0) {
            t.ok(true, 'No bhyve images imported, skipping bhyve provisioning');
        } else {
            var bhyveImages = body.filter(function getBhyve(img) {
                return !img.requirements || !img.requirements.brand ||
                    img.requirements.brand === 'bhyve';
            });

            var bhyveImage = bhyveImages.pop();

            if (bhyveImage) {
                BHYVE_IMAGE = bhyveImage;
                BHYVE_IMAGE_UUID = bhyveImage.id;
                t.ok(true, 'BHYVE_IMAGE_UUID: ' + BHYVE_IMAGE_UUID);
            }
        }
        t.end();
    });
});

test('add bhyve packages', function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    vasync.forEachPipeline({
        func: function addPackage(pkg, next) {
            common.addPackage(CLIENT, pkg, next);
        },
        inputs: CUSTOM_BHYVE_PACKAGES
    }, function onDone(err) {
        t.ifError(err, 'Add package error');
        t.end();
    });
});

test('CreateMachine - disks and no flexible_disk package', function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var obj = {
        disks: [ {}, {size: 512} ],
        image: BHYVE_IMAGE_UUID,
        name: 'bhyve-inflexible-test-' + process.pid,
        package: BHYVE_128_INFLEXIBLE.uuid
    };

    CLIENT.post('/my/machines', obj,
        function createdMachine(err, req, res, body) {
            t.ok(err);
            t.equal(err.statusCode, 409);
            t.equal(body.code, 'InvalidArgument');
            t.end();
    });
});

test('CreateMachine - 9 disks and flexible disk package', function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var obj = {
        disks: [
            {},
            { size: 512 },
            { size: 512 },
            { size: 512 },
            { size: 512 },
            { size: 512 },
            { size: 512 },
            { size: 512 },
            { size: 512 }
        ],
        image: BHYVE_IMAGE_UUID,
        name: 'bhyve-too-many-disks-test-' + process.pid,
        package: BHYVE_128_FLEXIBLE.uuid
    };

    CLIENT.post('/my/machines', obj,
        function createdMachine(err, req, res, body) {
            t.ok(err);
            t.equal(err.statusCode, 409);
            t.equal(body.code, 'InvalidArgument');
            t.end();
    });
});

test('CreateMachine - Multiple `remaining` disks',
    function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var obj = {
        disks: [
            {},
            { size: 512 },
            { size: 'remaining' },
            { size: 'remaining' }
        ],
        image: BHYVE_IMAGE_UUID,
        name: 'bhyve-invalid-remaining-test-' + process.pid,
        package: BHYVE_128_FLEXIBLE.uuid
    };

    CLIENT.post('/my/machines', obj,
        function createdMachine(err, req, res, body) {
            t.ok(err);
            t.equal(err.statusCode, 409);
            t.equal(body.code, 'InvalidArgument');
            t.end();
    });
});

test('CreateMachine - Disks size is greater than quota',
    function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var obj = {
        disks: [
            { size: 14336 },
            { size: 1025 }
        ],
        image: BHYVE_IMAGE_UUID,
        name: 'bhyve-oversized-disks-test-' + process.pid,
        package: BHYVE_128_FLEXIBLE.uuid
    };

    CLIENT.post('/my/machines', obj,
        function createdMachine(err, req, res, body) {
            t.ok(err);
            t.equal(err.statusCode, 409);
            t.equal(body.code, 'InvalidArgument');
            t.end();
    });
});

test('CreateMachine - No disks/inflexible disk package', function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var obj = {
        image: BHYVE_IMAGE_UUID,
        name: 'bhyve-no-disks-inflex-package-test-' + process.pid,
        package: BHYVE_128_INFLEXIBLE.uuid
    };

    CLIENT.post('/my/machines', obj,
        function createdMachine(err, req, res, body) {
            t.ifError(err, 'POST /my/machines error');
            t.equal(res.statusCode, 201, 'POST /my/machines status');
            common.checkHeaders(t, res.headers);
            t.equal(res.headers.location,
                util.format('/%s/machines/%s', CLIENT.login, body.id));
            t.ok(body, 'POST /my/machines body');
            checkMachine(t, body);

            BHYVE_MACHINE_UUID = body.id;

            t.ok(true, 'Requested provision of bhyve machine: ' +
                BHYVE_MACHINE_UUID);
            t.end();
    });
});

test('Wait For bhyve machine running - no disks/inflexible disk package',
    function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    machinesCommon.waitForRunningMachine(CLIENT, BHYVE_MACHINE_UUID,
        function waitForMachineCb(err) {
            t.ifError(err);

            if (err) {
                // Skip machine tests when machine creation fails
                BHYVE_MACHINE_UUID = false;
            }

            t.end();
    });
});

test('GetMachine has disks - no disks/inflexible disk package',
    function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var expectedDisks = [
        {
            boot: true,
            image: BHYVE_IMAGE_UUID,
            size: BHYVE_IMAGE.image_size
        },
        {
            size: BHYVE_128_INFLEXIBLE.quota
        }
    ];

    CLIENT.get('/my/machines/' + BHYVE_MACHINE_UUID,
        function gotMachine(err, req, res, body) {
            t.ifError(err);
            checkDisks(t, expectedDisks, body.disks);
            t.strictEqual(body.flexible, false);
            t.end();
    });
});

test('ListMachineDisks has disks - no disks/inflexible disk package',
    function listMachineDisksTest(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var expectedDisks = [
        {
            boot: true,
            pci_slot: '0:4:0',
            size: BHYVE_IMAGE.image_size,
            state: 'running'
        },
        {
            boot: false,
            pci_slot: '0:4:1',
            size: BHYVE_128_INFLEXIBLE.quota,
            state: 'running'
        }
    ];

    CLIENT.get('/my/machines/' + BHYVE_MACHINE_UUID + '/disks',
        function gotDisks(err, req, res, disks) {
            t.ifError(err);

            checkDisks(t, expectedDisks, disks);
            t.ok(disks[0].id, 'disks[0].id');
            t.ok(disks[1].id, 'disks[1].id');

            DISK_UUID = disks[1].id;

            t.end();
    });
});

test('ListMachineDisks OTHER - no access',
    function listMachineDisksOtherTest(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    OTHER.get('/my/machines/' + BHYVE_MACHINE_UUID + '/disks',
        function gotDisks(err, req, res, disks) {
            t.ok(err, 'err');
            t.equal(err.statusCode, 404, 'statusCode');
            t.end();
    });
});

test('GetMachineDisk has disk - no disks/inflexible disk package',
    function getMachineDiskTest(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    CLIENT.get('/my/machines/' + BHYVE_MACHINE_UUID + '/disks/' + DISK_UUID,
        function gotDisk(err, req, res, disk) {
            t.ifError(err);

            t.deepEqual(disk, {
                id: DISK_UUID,
                boot: false,
                pci_slot: '0:4:1',
                size: BHYVE_128_INFLEXIBLE.quota,
                state: 'running'
            });

            t.end();
    });
});

test('GetMachineDisks OTHER - no access',
    function getMachineDisksOtherTest(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    OTHER.get('/my/machines/' + BHYVE_MACHINE_UUID + '/disks/' + DISK_UUID,
        function gotDisk(err, req, res, disks) {
            t.ok(err, 'err');
            t.equal(err.statusCode, 404, 'statusCode');
            t.end();
    });
});

function stopMachine(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    CLIENT.post('/my/machines/' + BHYVE_MACHINE_UUID, {
        action: 'stop'
    }, function onStop(err) {
        t.ifError(err, 'err');

        CLIENT.vmapi.listJobs({
            vm_uuid: BHYVE_MACHINE_UUID,
            task: 'stop'
        }, function listJobsCb(err2, jobs) {
            t.ifError(err2, 'list jobs error');

            var jobUuid = jobs[0].uuid;
            machinesCommon.waitForJob(CLIENT, jobUuid, function onWaitCb(err3) {
                t.ifError(err3, 'Check state error');
                t.end();
            });
        });
    });
}

test('Stop machine 1', stopMachine);

test('CreateMachineDisk cannot create disk - no disks/inflexible disk package',
    function createMachineDiskCannotCreateTest(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    CLIENT.post('/my/machines/' + BHYVE_MACHINE_UUID + '/disks', {
        size: 128
    }, function createDisk(err, req, res, disk) {
        t.ok(err);

        t.equal(err.name, 'VmWithoutFlexibleDiskSizeError', 'disk.name');
        t.equal(disk.code, 'VmWithoutFlexibleDiskSize', 'disk.code');

        t.end();
    });
});

test('ResizeMachineDisk cannot resize disk - no disks/inflexible disk package',
    function resizeMachineDiskTest(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    CLIENT.post('/my/machines/' + BHYVE_MACHINE_UUID + '/disks/' + DISK_UUID, {
        size: BHYVE_128_INFLEXIBLE.quota - 128
    }, function resizeDisk(err, req, res, disk) {
        t.ok(err);

        t.equal(err.name, 'VmWithoutFlexibleDiskSizeError', 'disk.name');
        t.equal(disk.code, 'VmWithoutFlexibleDiskSize', 'disk.code');

        t.end();
    });
});

test('DeleteMachineDisk cannot delete disk - no disks/inflexible disk package',
    function deleteMachineDisk(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    CLIENT.del('/my/machines/' + BHYVE_MACHINE_UUID + '/disks/' + DISK_UUID,
        function gotDisk(err, req, res, disk) {
            t.ok(err);

            t.equal(err.name, 'VmWithoutFlexibleDiskSizeError', 'disk.name');
            t.equal(disk.code, 'VmWithoutFlexibleDiskSize', 'disk.code');

            t.end();
    });
});

test('Delete bhyve test vm - no disks/inflexible disk package',
    function (t) {
    if (!BHYVE_MACHINE_UUID) {
        t.end();
        return;
    }

    deleteMachine(t, CLIENT, OTHER, BHYVE_MACHINE_UUID, function onDelete() {
            BHYVE_MACHINE_UUID = undefined;
            t.end();
    });
});

test('CreateMachine - No disks/package has disks', function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var obj = {
        image: BHYVE_IMAGE_UUID,
        name: 'bhyve-package-test-' + process.pid,
        package: BHYVE_128_FLEXIBLE_DISKS.uuid
    };

    CLIENT.post('/my/machines', obj,
        function createdMachine(err, req, res, body) {
            t.ifError(err, 'POST /my/machines error');
            t.equal(res.statusCode, 201, 'POST /my/machines status');
            common.checkHeaders(t, res.headers);
            t.equal(res.headers.location,
                util.format('/%s/machines/%s', CLIENT.login, body.id));
            t.ok(body, 'POST /my/machines body');
            checkMachine(t, body);

            BHYVE_MACHINE_UUID = body.id;

            t.ok(true, 'Requested provision of bhyve machine: ' +
                BHYVE_MACHINE_UUID);
            t.end();
    });
});

test('Wait For bhyve machine running - No disks/package has disks',
    function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    machinesCommon.waitForRunningMachine(CLIENT, BHYVE_MACHINE_UUID,
        function waitForMachineCb(err) {
            t.ifError(err);

            if (err) {
                // Skip machine tests when machine creation fails
                BHYVE_MACHINE_UUID = false;
            }

            t.end();
    });
});

test('GetMachine has disks - No disks/package has disks', function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var expectedDisks = [
        {
            boot: true,
            image: BHYVE_IMAGE_UUID,
            size: BHYVE_IMAGE.image_size
        },
        {
            size: BHYVE_128_FLEXIBLE_DISKS.disks[1].size
        }
    ];

    var pkg = BHYVE_128_FLEXIBLE_DISKS;
    var usedSpace = pkg.disks[1].size + BHYVE_IMAGE.image_size;
    var expectedFree = pkg.quota - usedSpace;

    CLIENT.get('/my/machines/' + BHYVE_MACHINE_UUID,
        function gotMachine(err, req, res, body) {
            t.ifError(err);
            checkDisks(t, expectedDisks, body.disks);
            checkDisksQuota(t, body.disks,
                BHYVE_128_FLEXIBLE_DISKS.quota - body.free_space);
            t.strictEqual(body.flexible, true);
            t.equal(body.free_space, expectedFree);
            t.end();
    });
});

test('Delete bhyve test vm - No disks/package has disks', function (t) {
    if (!BHYVE_MACHINE_UUID) {
        t.end();
        return;
    }

    deleteMachine(t, CLIENT, OTHER, BHYVE_MACHINE_UUID,
        function onDelete() {
            BHYVE_MACHINE_UUID = undefined;
            t.end();
    });
});

test('CreateMachine - Disks/flexible disk package', function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    DISK_UUID = 'dea91a7f-5fe3-4408-b25a-994c97a7975e';

    var obj = {
        disks: [
            { id: 'eea4e223-dee6-44dc-a7e1-71f996e534f0' },
            { id: DISK_UUID, size: 512},
            { id: 'c41ce11e-bed2-45d2-bdb8-8dc889ed8ced', size: 'remaining' }
        ],
        image: BHYVE_IMAGE_UUID,
        name: 'bhyve-disks-flex-package-test-' + process.pid,
        package: BHYVE_128_FLEXIBLE.uuid
    };

    CLIENT.post('/my/machines', obj,
        function createdMachine(err, req, res, body) {
            t.ifError(err, 'POST /my/machines error');
            t.equal(res.statusCode, 201, 'POST /my/machines status');
            common.checkHeaders(t, res.headers);
            t.equal(res.headers.location,
                util.format('/%s/machines/%s', CLIENT.login, body.id));
            t.ok(body, 'POST /my/machines body');
            checkMachine(t, body);

            BHYVE_MACHINE_UUID = body.id;

            // Handy to output this to stdout in order to poke around COAL:
            t.ok(true, 'Requested provision of bhyve machine: ' +
                BHYVE_MACHINE_UUID);
            t.end();
    });
});

test('Wait For bhyve machine running - Disks/flexible disk package',
    function (t) {
        if (!BHYVE_IMAGE_UUID) {
            t.ok(true, 'No bhyve images. Test skipped');
            t.end();
            return;
        }

        machinesCommon.waitForRunningMachine(CLIENT, BHYVE_MACHINE_UUID,
            function waitForMachineCb(err) {
                t.ifError(err);

                if (err) {
                    // Skip machine tests when machine creation fails
                    BHYVE_MACHINE_UUID = false;
                }

                t.end();
        });
    }
);

test('GetMachine has disks - Disks/flexible disk package', function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var expectedDisks = [
        {
            boot: true,
            image: BHYVE_IMAGE_UUID,
            size: BHYVE_IMAGE.image_size,
            id: 'eea4e223-dee6-44dc-a7e1-71f996e534f0'
        },
        {
            size: 512,
            id: DISK_UUID
        },
        {
            size: BHYVE_128_FLEXIBLE.quota - BHYVE_IMAGE.image_size - 512,
            id: 'c41ce11e-bed2-45d2-bdb8-8dc889ed8ced'
        }
    ];

    CLIENT.get('/my/machines/' + BHYVE_MACHINE_UUID,
        function gotMachine(err, req, res, body) {
            t.ifError(err);
            t.strictEqual(body.flexible, true);
            checkDisksQuota(t, body.disks,
                BHYVE_128_FLEXIBLE.quota - body.free_space);
            t.deepEqual(body.disks, expectedDisks);
            t.end();
    });
});

test('Stop machine 2', stopMachine);

test('ResizeMachineDisk OTHER - no access',
    function resizeMachineDiskOtherTest(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    OTHER.post('/my/machines/' + BHYVE_MACHINE_UUID + '/disks/' + DISK_UUID, {
        size: 128
    }, function resizeDisk(err, req, res, disk) {
        t.ok(err, 'err');

        t.equal(err.statusCode, 404, 'statusCode');
        t.equal(err.name, 'ResourceNotFoundError');

        t.end();
    });
});

test('ResizeMachineDisk resize disk down - Disks/flexible disk package',
    function resizeMachineDiskDownTest(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    CLIENT.post('/my/machines/' + BHYVE_MACHINE_UUID + '/disks/' + DISK_UUID, {
        size: 128
    }, function resizeDisk(err, req, res, disk) {
        t.ok(err, 'err');

        t.equal(err.name, 'ValidationFailedError', 'err.name');
        t.equal(disk.errors[0].field, 'size', 'size');
        t.equal(disk.errors[0].message,
            'Reducing disk size is a dangerous operation');

        t.end();
    });
});

test('ResizeMachineDisk resize disk down 2 - Disks/flexible disk package',
    function resizeMachineDisk2Test(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var path = '/my/machines/' + BHYVE_MACHINE_UUID + '/disks/' + DISK_UUID;

    CLIENT.post(path, {
        size: 128,
        dangerous_allow_shrink: true
    }, function resizeDisk(err, req, res, disk) {
        t.ifError(err, 'err');

        t.deepEqual(disk, {
            id: DISK_UUID,
            pci_slot: '0:4:1',
            size: 512,
            boot: false,
            state: 'resizing'
        }, 'disk');

        poll();
    });

    var count = 0;
    function poll() {
        if (count > 10) {
            t.fail('Failed to resize disk in time');
            t.end();
            return;
        }

        count += 1;

        CLIENT.get(path, function getCb(err, req, res, disk) {
            t.ifError(err, 'err');

            if (disk.state !== 'stopped') {
                setTimeout(poll, 2000);
                return;
            }

            t.deepEqual(disk, {
                id: DISK_UUID,
                pci_slot: '0:4:1',
                size: 128,
                boot: false,
                state: 'stopped'
            }, 'disk');

            t.end();
        });
    }
});

test('DeleteMachineDisk OTHER - no access',
    function deleteMachineDiskOtherTest(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    OTHER.del('/my/machines/' + BHYVE_MACHINE_UUID + '/disks/' + DISK_UUID,
        function deleteDisk(err, req, res, disk) {
        t.ok(err, 'err');

        t.equal(err.statusCode, 404, 'statusCode');
        t.equal(err.name, 'ResourceNotFoundError');

        t.end();
    });
});

test('DeleteMachineDisk delete disk - Disks/flexible disk package',
    function deleteMachineDisk2(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var path = '/my/machines/' + BHYVE_MACHINE_UUID + '/disks/' + DISK_UUID;

    CLIENT.del(path, function gotDisk(err, req, res, disk) {
        t.ifError(err);
        t.equal(res.statusCode, 204, 'statusCode');
        poll();
    });

    var count = 0;
    function poll() {
        if (count > 10) {
            t.fail('Failed to delete disk in time');
            t.end();
            return;
        }

        count += 1;

        CLIENT.get(path, function getCb(err, req, res, disk) {
            if (err && res.statusCode === 404) {
                t.end();
                return;
            }

            t.ifError(err, 'err');
            t.deepEqual(disk, {
                id: DISK_UUID,
                pci_slot: '0:4:1',
                size: 128,
                boot: false,
                state: 'deleting'
            }, 'disk');

            setTimeout(poll, 2000);
        });
    }
});

test('CreateMachineDisk OTHER - no access',
    function createMachineDiskOtherTest(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    OTHER.post('/my/machines/' + BHYVE_MACHINE_UUID + '/disks', {
        pci_slot: '0:4:9',
        size: 128
    }, function createDisk(err, req, res, disk) {
        t.ok(err);
        t.equal(res.statusCode, 404, 'statusCode');
        t.equal(err.name, 'ResourceNotFoundError', 'err.name');
        t.end();
    });
});

test('CreateMachineDisk - Disks/flexible disk package',
    function createMachineDiskTest(t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    CLIENT.post('/my/machines/' + BHYVE_MACHINE_UUID + '/disks', {
        pci_slot: '0:4:4',
        size: 256
    }, function createDisk(err, req, res, disk) {
        t.ifError(err, 'err');

        DISK_UUID = disk.id;

        poll();
    });

    var count = 0;
    function poll() {
        if (count > 10) {
            t.fail('Failed to create disk in time');
            t.end();
            return;
        }

        count += 1;

        var path = '/my/machines/' + BHYVE_MACHINE_UUID + '/disks/' + DISK_UUID;

        CLIENT.get(path, function getCb(err, req, res, disk) {
            if (res.statusCode === 404) {
                setTimeout(poll, 2000);
                return;
            }

            t.ifError(err, 'err');

            t.deepEqual(disk, {
                id: DISK_UUID,
                pci_slot: '0:4:4',
                size: 256,
                boot: false,
                state: 'stopped'
            }, 'disk');

            t.end();
        });
    }
});

test('Delete bhyve test vm - Disks/flexible disk package', function (t) {
    if (!BHYVE_MACHINE_UUID) {
        t.end();
        return;
    }

    deleteMachine(t, CLIENT, OTHER, BHYVE_MACHINE_UUID,
        function onDelete() {
            BHYVE_MACHINE_UUID = undefined;
            t.end();
    });
});

test('CreateMachine - Disks sum to quota/flex disk package', function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var obj = {
        disks: [
            { id: 'eea4e223-dee6-44dc-a7e1-71f996e534f0', size: 14336 },
            { id: 'dea91a7f-5fe3-4408-b25a-994c97a7975e', size: 512},
            { id: 'c41ce11e-bed2-45d2-bdb8-8dc889ed8ced', size: 512 }
        ],
        image: BHYVE_IMAGE_UUID,
        name: 'bhyve-disks-max-test-' + process.pid,
        package: BHYVE_128_FLEXIBLE.uuid
    };

    CLIENT.post('/my/machines', obj,
        function createdMachine(err, req, res, body) {
            t.ifError(err, 'POST /my/machines error');
            t.equal(res.statusCode, 201, 'POST /my/machines status');
            common.checkHeaders(t, res.headers);
            t.equal(res.headers.location,
                util.format('/%s/machines/%s', CLIENT.login, body.id));
            t.ok(body, 'POST /my/machines body');
            checkMachine(t, body);

            BHYVE_MACHINE_UUID = body.id;

            // Handy to output this to stdout in order to poke around COAL:
            t.ok(true, 'Requested provision of bhyve machine: ' +
                BHYVE_MACHINE_UUID);
            t.end();
    });
});

test('Wait For bhyve machine running - Disks sum to quota/flex disk package',
    function (t) {
        if (!BHYVE_IMAGE_UUID) {
            t.ok(true, 'No bhyve images. Test skipped');
            t.end();
            return;
        }

        machinesCommon.waitForRunningMachine(CLIENT, BHYVE_MACHINE_UUID,
            function waitForMachineCb(err) {
                t.ifError(err);

                if (err) {
                    // Skip machine tests when machine creation fails
                    BHYVE_MACHINE_UUID = false;
                }

                t.end();
        });
    }
);

test('GetMachine has disks - Disks sum to quota/flex disk package',
    function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var expectedDisks = [
        {
            boot: true,
            image: BHYVE_IMAGE_UUID,
            size: 14336,
            id: 'eea4e223-dee6-44dc-a7e1-71f996e534f0'
        },
        {
            size: 512,
            id: 'dea91a7f-5fe3-4408-b25a-994c97a7975e'
        },
        {
            size: 512,
            id: 'c41ce11e-bed2-45d2-bdb8-8dc889ed8ced'
        }
    ];

    CLIENT.get('/my/machines/' + BHYVE_MACHINE_UUID,
        function gotMachine(err, req, res, body) {
            t.ifError(err);
            t.strictEqual(body.flexible, true);
            checkDisksQuota(t, body.disks,
                BHYVE_128_FLEXIBLE.quota);
            t.deepEqual(body.disks, expectedDisks);
            t.end();
    });
});

test('Delete bhyve test vm - Disks sum to quota/flexible disk package',
    function (t) {
    if (!BHYVE_MACHINE_UUID) {
        t.end();
        return;
    }

    deleteMachine(t, CLIENT, OTHER, BHYVE_MACHINE_UUID,
        function onDelete() {
            BHYVE_MACHINE_UUID = undefined;
            t.end();
    });
});

test('CreateMachine - Disks with remaining/flex disk package',
    function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var obj = {
        disks: [
            { id: 'eea4e223-dee6-44dc-a7e1-71f996e534f0' },
            { id: 'dea91a7f-5fe3-4408-b25a-994c97a7975e', size: 'remaining'},
            { id: 'c41ce11e-bed2-45d2-bdb8-8dc889ed8ced', size: 512 }
        ],
        image: BHYVE_IMAGE_UUID,
        name: 'bhyve-disks-flex-package-test-' + process.pid,
        package: BHYVE_128_FLEXIBLE.uuid
    };

    CLIENT.post('/my/machines', obj,
        function createdMachine(err, req, res, body) {
            t.ifError(err, 'POST /my/machines error');
            t.equal(res.statusCode, 201, 'POST /my/machines status');
            common.checkHeaders(t, res.headers);
            t.equal(res.headers.location,
                util.format('/%s/machines/%s', CLIENT.login, body.id));
            t.ok(body, 'POST /my/machines body');
            checkMachine(t, body);

            BHYVE_MACHINE_UUID = body.id;

            // Handy to output this to stdout in order to poke around COAL:
            t.ok(true, 'Requested provision of bhyve machine: ' +
                BHYVE_MACHINE_UUID);
            t.end();
    });
});

test('Wait For bhyve machine running - Disks with remaining/flex disk package',
    function (t) {
        if (!BHYVE_IMAGE_UUID) {
            t.ok(true, 'No bhyve images. Test skipped');
            t.end();
            return;
        }

        machinesCommon.waitForRunningMachine(CLIENT, BHYVE_MACHINE_UUID,
            function waitForMachineCb(err) {
                t.ifError(err);

                if (err) {
                    // Skip machine tests when machine creation fails
                    BHYVE_MACHINE_UUID = false;
                }

                t.end();
        });
    }
);

test('GetMachine has disks - Disks with remaining/flex disk package',
    function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var expectedDisks = [
        {
            boot: true,
            image: BHYVE_IMAGE_UUID,
            size: BHYVE_IMAGE.image_size,
            id: 'eea4e223-dee6-44dc-a7e1-71f996e534f0'
        },
        {
            size: BHYVE_128_FLEXIBLE.quota - BHYVE_IMAGE.image_size - 512,
            id: 'dea91a7f-5fe3-4408-b25a-994c97a7975e'
        },
        {
            size: 512,
            id: 'c41ce11e-bed2-45d2-bdb8-8dc889ed8ced'
        }
    ];

    CLIENT.get('/my/machines/' + BHYVE_MACHINE_UUID,
        function gotMachine(err, req, res, body) {
            t.ifError(err);
            t.strictEqual(body.flexible, true);
            checkDisksQuota(t, body.disks,
                BHYVE_128_FLEXIBLE.quota - body.free_space);
            t.deepEqual(body.disks, expectedDisks);
            t.end();
    });
});

test('Delete bhyve test vm - Disks with remaining/flex disk package',
    function (t) {
    if (!BHYVE_MACHINE_UUID) {
        t.end();
        return;
    }

    deleteMachine(t, CLIENT, OTHER, BHYVE_MACHINE_UUID,
        function onDelete() {
            BHYVE_MACHINE_UUID = undefined;
            t.end();
    });
});

test('CreateMachine - No disks/flexible disk package', function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var obj = {
        image: BHYVE_IMAGE_UUID,
        name: 'bhyve-no-disks-flex-package-test-' + process.pid,
        package: BHYVE_128_FLEXIBLE.uuid
    };

    CLIENT.post('/my/machines', obj,
        function createdMachine(err, req, res, body) {
            t.ifError(err, 'POST /my/machines error');
            t.equal(res.statusCode, 201, 'POST /my/machines status');
            common.checkHeaders(t, res.headers);
            t.equal(res.headers.location,
                util.format('/%s/machines/%s', CLIENT.login, body.id));
            t.ok(body, 'POST /my/machines body');
            checkMachine(t, body);

            BHYVE_MACHINE_UUID = body.id;

            t.ok(true, 'Requested provision of bhyve machine: ' +
                BHYVE_MACHINE_UUID);
            t.end();
    });
});

test('Wait For bhyve machine running - No disks/flexible disk package',
    function (t) {
        if (!BHYVE_IMAGE_UUID) {
            t.ok(true, 'No bhyve images. Test skipped');
            t.end();
            return;
        }

        machinesCommon.waitForRunningMachine(CLIENT, BHYVE_MACHINE_UUID,
            function waitForMachineCb(err) {
                t.ifError(err);

                if (err) {
                    // Skip machine tests when machine creation fails
                    BHYVE_MACHINE_UUID = false;
                }

                t.end();
        });
    }
);

test('GetMachine has disks - No disks/flexible disk package', function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var expectedDisks = [
        {
            boot: true,
            image: BHYVE_IMAGE_UUID,
            size: BHYVE_IMAGE.image_size
        },
        {
            size: BHYVE_128_FLEXIBLE.quota - BHYVE_IMAGE.image_size
        }
    ];

    CLIENT.get('/my/machines/' + BHYVE_MACHINE_UUID,
        function gotMachine(err, req, res, body) {
            t.ifError(err);
            checkDisksQuota(t, body.disks,
                BHYVE_128_FLEXIBLE.quota - body.free_space);
            checkDisks(t, expectedDisks, body.disks);
            t.strictEqual(body.flexible, true);
            t.end();
    });
});

test('Delete bhyve test vm - No disks/flexible disk package', function (t) {
    if (!BHYVE_MACHINE_UUID) {
        t.end();
        return;
    }

    deleteMachine(t, CLIENT, OTHER, BHYVE_MACHINE_UUID,
        function onDelete() {
            BHYVE_MACHINE_UUID = undefined;
            t.end();
    });
});

test('CreateMachine - Package has remaining boot disk', function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var obj = {
        image: BHYVE_IMAGE_UUID,
        name: 'bhyve-remaining-test-' + process.pid,
        package: BHYVE_128_FLEXIBLE_REMAINING.uuid
    };

    CLIENT.post('/my/machines', obj,
        function createdMachine(err, req, res, body) {
            t.ifError(err, 'POST /my/machines error');
            t.equal(res.statusCode, 201, 'POST /my/machines status');
            common.checkHeaders(t, res.headers);
            t.equal(res.headers.location,
                util.format('/%s/machines/%s', CLIENT.login, body.id));
            t.ok(body, 'POST /my/machines body');
            checkMachine(t, body);

            BHYVE_MACHINE_UUID = body.id;

            t.ok(true, 'Requested provision of bhyve machine: ' +
                BHYVE_MACHINE_UUID);
            t.end();
    });
});

test('Wait For bhyve machine running - Package has remaining boot disk',
    function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    machinesCommon.waitForRunningMachine(CLIENT, BHYVE_MACHINE_UUID,
        function waitForMachineCb(err) {
            t.ifError(err);

            if (err) {
                // Skip machine tests when machine creation fails
                BHYVE_MACHINE_UUID = false;
            }

            t.end();
    });
});

test('GetMachine has disks - Package has remaining boot disk', function (t) {
    if (!BHYVE_IMAGE_UUID) {
        t.ok(true, 'No bhyve images. Test skipped');
        t.end();
        return;
    }

    var expectedDisks = [
        {
            boot: true,
            image: BHYVE_IMAGE_UUID,
            size: BHYVE_128_FLEXIBLE_REMAINING.quota
        }
    ];

    CLIENT.get('/my/machines/' + BHYVE_MACHINE_UUID,
        function gotMachine(err, req, res, body) {
            t.ifError(err);
            checkDisks(t, expectedDisks, body.disks);
            checkDisksQuota(t, body.disks, BHYVE_128_FLEXIBLE_REMAINING.quota);
            t.strictEqual(body.flexible, true);
            t.strictEqual(body.free_space, 0);
            t.end();
    });
});

test('Delete bhyve test vm - Package has remaining boot disk', function (t) {
    if (!BHYVE_MACHINE_UUID) {
        t.end();
        return;
    }

    deleteMachine(t, CLIENT, OTHER, BHYVE_MACHINE_UUID,
        function onDelete() {
            BHYVE_MACHINE_UUID = undefined;
            t.end();
    });
});

test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (teardownErr) {
        t.ifError(teardownErr, 'Teardown success');

        if (!BHYVE_IMAGE_UUID) {
            t.end();
            return;
        }

        vasync.forEachParallel({
            func: function deletePackage(pkg, next) {
                common.deletePackage(CLIENT, pkg, next);
            },
            inputs: CUSTOM_BHYVE_PACKAGES
        }, function onDone(pkgErr) {
            t.ifError(pkgErr, 'Delete package error');
            t.end();
        });
    });
});
