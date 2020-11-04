/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var test = require('@smaller/tap').test;
var jsprim = require('jsprim');
var plugin = require('../../plugins/provision_limits');
var restify = require('restify');


// --- Globals

var clone = jsprim.deepCopy;

var ACCOUNT = {
    uuid: 'd987aa8e-bfa3-11e7-b71c-28cfe91f7d53',
    isAdmin: function () { return false; }
};

var API = {
    getImage: function () {},
    listImages: function () {},
    getActiveVmsForAccount: function () {},
    datacenterName: 'testdc',
    service: 'cloudapi',
    NotAuthorizedError: restify.NotAuthorizedError,
    log: {
        debug: function () {},
        info: function () {},
        trace: function () {},
        warn: function () {}
    }
};

var IMAGE = {
    uuid: '4cae467a-bfa5-11e7-ae02-28cfe91f7d53',
    name: 'testimage',
    type: 'lx-dataset',
    os: 'other'
};

var PKG = {
    max_physical_memory: 256,
    quota: 10 * 1024
};

var REQ_ID = '8882779e-f9ab-11e7-a697-93c18b2a37ef';

// some stub UUIDs
var UUID1 = '9baf048a-ab81-11e8-9613-1b0165c9105b';
var UUID2 = '2f832786-ab82-11e8-a11d-fbe98e753f94';
var UUID3 = '340d17d0-ab82-11e8-8881-03d83e99e2df';
var UUID4 = '3a97e990-ab82-11e8-a3c8-671dae682a29';


// --- Helpers


function check1_provision(t, cfgLimits, ufdsLimits, tenant, vms, fields, pkg,
    shouldSucceed) {
    check1_resize(t, cfgLimits, ufdsLimits, tenant, null, vms, fields, pkg,
        shouldSucceed);
}


function check1_resize(t, cfgLimits, ufdsLimits, tenant, existingVm, vms, pkg,
    fields, shouldSucceed) {
    var api = clone(API);
    api.getImage = function getImgStub() {
        t.fail('No image should be needed');
    };
    api.listImages = function listImgStub() {
        t.fail('No images should be loaded');
    };
    api.getActiveVmsForAccount = function activeVmsStub(args, cb) {
        t.equal(args.account.uuid, ACCOUNT.uuid, 'account uuid should match');
        t.equal(args.fields, fields, 'fields should match');
        return cb(null, vms);
    };

    var cmd = existingVm ? 'allowResize' : 'allowProvision';
    var allow = plugin[cmd](api, cfgLimits);

    var account = clone(ACCOUNT);
    account.tenant = tenant;
    account.listLimits = function limitsStub(cb) {
        return cb(null, ufdsLimits);
    };

    var opts = {
        account: account,
        vm: existingVm,
        image: {
            image_uuid: IMAGE.uuid
        },
        pkg: pkg,
        req_id: REQ_ID
    };

    allow(opts, function onAllow(err) {
        if (shouldSucceed) {
            t.ifError(err, 'Provision/resize should succeed');
        } else {
            t.ok(err, 'Provision/resize should fail');
        }

        opts.api = api;
        opts.config = cfgLimits;

        checkProvisionLimits(t, cfgLimits, ufdsLimits, opts);
    });
}

function checkProvisionLimits(t, cfgLimits, ufdsLimits, opts) {
    // Remember all original limits, but remove the used setting from the limits
    // prior to passing to the plugin._getProvisionLimits call.
    var originalLimits = [];
    Object.keys(cfgLimits).forEach(function (name) {
        originalLimits = originalLimits.concat(clone(cfgLimits[name]));
        // Clear used value from limits.
        cfgLimits[name].forEach(function (limit) {
            delete limit.used;
        });
    });
    // For ufdsLimits, each limit entry is a serialized JSON object.
    ufdsLimits.forEach(function (config) {
        var limit;
        var limits;

        if (config.limit && config.datacenter === opts.api.datacenterName) {
            if (Array.isArray(config.limit)) {
                limits = config.limit.map(JSON.parse);
                originalLimits = originalLimits.concat(clone(limits));
                // Clear used value from limits.
                limits.forEach(function (l) {
                    delete l.used;
                });
                // Set limit back (without the used value).
                config.limit = limits.map(JSON.stringify);
            } else {
                limit = JSON.parse(config.limit);
                originalLimits.push(clone(limit));
                // Clear used value from limits.
                delete limit.used;
                // Set limit back (without the used value).
                config.limit = JSON.stringify(limit);
            }
        }
    });

    plugin._getProvisionLimits(opts, function _onGetLimits(_, limits) {
        // For all limits returned, ensure the used amount is what we
        // expected it would be.
        limits.forEach(function _checkLimitUsed(limit) {
            var expectedLimit = originalLimits.find(function (l) {
                // Only find limits that define a 'used' value.
                if (!l.hasOwnProperty('used')) {
                    return false;
                }
                // Find by an exact copy (by property inspection).
                return Object.keys(limit).every(function (name) {
                    if (name === 'used') {
                        return true; // Ignore 'used' values.
                    }
                    if (limit[name] === undefined) {
                        return true; // Ignore undefined (cleared) values.
                    }
                    return limit[name] === l[name];
                });
            });
            if (!expectedLimit) {
                t.fail('No limit match for: ' + JSON.stringify(limit));
            } else {
                t.equal(limit.used, expectedLimit.used,
                    'Limit used should match the expected value');
            }
        });

        t.end();
    });
}

function check2_provision(t, limits, vms, listImages, shouldSucceed) {
    check2_resize(t, limits, null, vms, listImages, shouldSucceed);
}


function check2_resize(t, limits, existingVm, vms, listImages, shouldSucceed) {
    var api = clone(API);
    api.getImage = function getImgStub(obj, cb) {
        t.deepEqual(obj, {
            image: { uuid: IMAGE.uuid },
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts is present');
        t.ok(cb, 'cb is present');
        return cb(null, IMAGE);
    };
    api.listImages = listImages;
    api.getActiveVmsForAccount = function activeVmsStub(args, cb) {
        t.equal(args.account.uuid, ACCOUNT.uuid, 'account uuid should match');
        return cb(null, vms);
    };

    var cmd = existingVm ? 'allowResize' : 'allowProvision';
    var allow = plugin[cmd](api, { defaults: limits });

    var account = clone(ACCOUNT);
    account.listLimits = function limitsStub(cb) {
        return cb(null, []);
    };

    function ImageV2(imageUuid) {
        this.image_uuid = imageUuid;
        return this;
    }

    var opts = {
        account: account,
        vm: existingVm,
        image: new ImageV2(IMAGE.uuid),
        pkg: PKG,
        req_id: REQ_ID
    };

    allow(opts, function onAllow(err) {
        if (shouldSucceed) {
            t.ifError(err, 'Provision/resize should succeeed');
        } else {
            t.ok(err, 'Provision/resize should fail');
        }

        opts.api = api;
        opts.config = {defaults: limits};

        checkProvisionLimits(t, opts.config, [], opts);
    });
}


// --- Tests


test('Setup allowProvision without api',
function (t) {
    try {
        plugin.allowProvision();
    } catch (e) {
        t.equal(e.message, 'api (object) is required', 'err message');
        t.end();
    }
});


test('Setup allowResize without api',
function (t) {
    try {
        plugin.allowResize();
    } catch (e) {
        t.equal(e.message, 'api (object) is required', 'err message');
        t.end();
    }
});


test('Setup allowProvision without cfg',
function (t) {
    try {
        plugin.allowProvision(API);
    } catch (e) {
        t.equal(e.message, 'cfg (object) is required', 'err message');
        t.end();
    }
});


test('Setup allowResize without cfg',
function (t) {
    try {
        plugin.allowResize(API);
    } catch (e) {
        t.equal(e.message, 'cfg (object) is required', 'err message');
        t.end();
    }
});


test('Setup allowProvision with invalid cfg',
function (t) {
    try {
        plugin.allowProvision(API, { accounts: 'foo' });
    } catch (e) {
        t.equal(e.message, 'cfg.defaults ([object]) is required', 'err msg');
        t.end();
    }
});


test('Setup allowResize with invalid cfg',
function (t) {
    try {
        plugin.allowResize(API, { accounts: 'foo' });
    } catch (e) {
        t.equal(e.message, 'cfg.defaults ([object]) is required', 'err msg');
        t.end();
    }
});


test('Setup allowProvision with valid cfg',
function (t) {
    var allowProvision = plugin.allowProvision(API, { defaults: [] });
    t.equal(typeof (allowProvision), 'function', 'func type');
    t.equal(allowProvision.name, 'checkProvisionAndResizeLimits', 'func name');
    t.end();
});


test('Setup allowResize with valid cfg',
function (t) {
    var allowResize = plugin.allowResize(API, { defaults: [] });
    t.equal(typeof (allowResize), 'function', 'func type');
    t.equal(allowResize.name, 'checkProvisionAndResizeLimits', 'func name');
    t.end();
});


test('allowProvision - no tenant/no ufdsLimits/one VM',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 2, used: 1 } ],
        small: [ { value: 3 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, true);
});


test('allowProvision - no tenant/no ufdsLimits/two VMs',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 }
    ];
    var cfg = {
        defaults: [ { value: 2, used: 2 } ],
        small: [ { value: 3 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, false);
});


// should allow resizes even if we're over a max num of VMs, since the num of
// VMs has nothing to do with VM size itself
test('allowResize - no tenant/no ufdsLimits/three VMs',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 },
        { ram: 256, uuid: UUID3 }
    ];
    var cfg = {
        defaults: [ { value: 2, used: 3 } ],
        small: [ { value: 3 } ]
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowProvision - unknown tenant/no ufdsLimits/one VMs',
function (t) {
    var fields = 'ram';
    var tenant = 'supercalifragilisticexpialidocious';
    var ufdsLimits = [];
    var vms = [
        { ram: 256, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 2, used: 1 } ],
        small: [ { value: 3 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, true);
});


test('allowProvision - unknown tenant/no ufdsLimits/two VMs',
function (t) {
    var fields = 'ram';
    var tenant = 'supercalifragilisticexpialidocious';
    var ufdsLimits = [];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 }
    ];
    var cfg = {
        defaults: [ { value: 2, used: 2 } ],
        small: [ { value: 3 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, false);
});


// should allow resizes even if we're over a max num of VMs, since the num of
// VMs has nothing to do with VM size itself
test('allowResize - unknown tenant/no ufdsLimits/three VMs',
function (t) {
    var fields = 'ram';
    var tenant = 'supercalifragilisticexpialidocious';
    var ufdsLimits = [];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 },
        { ram: 256, uuid: UUID3 }
    ];
    var cfg = {
        defaults: [ { value: 2, used: 3 } ],
        small: [ { value: 3 } ]
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowProvision - tenant/no ufdsLimits/two VMs',
function (t) {
    var fields = 'ram';
    var tenant = 'small';
    var ufdsLimits = [];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 }
    ];
    var cfg = {
        defaults: [ { value: 2 } ],
        small: [ { value: 3, used: 2 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, true);
});


test('allowProvision - tenant/no ufdsLimits/three VMs',
function (t) {
    var fields = 'ram';
    var tenant = 'small';
    var ufdsLimits = [];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 },
        { ram: 256, uuid: UUID3 }
    ];
    var cfg = {
        defaults: [ { value: 2 } ],
        small: [ { value: 3, used: 3 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, false);
});


// should allow resizes even if we're over a max num of VMs, since the num of
// VMs has nothing to do with VM size itself
test('allowResize - tenant/no ufdsLimits/four VMs',
function (t) {
    var fields = 'ram';
    var tenant = 'small';
    var ufdsLimits = [];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 },
        { ram: 256, uuid: UUID3 },
        { ram: 256, uuid: UUID4 }
    ];
    var cfg = {
        defaults: [ { value: 2 } ],
        small: [ { value: 3, used: 4 } ]
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowProvision - no tenant/no ufdsLimits/no VMs',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [];
    var cfg = {
        defaults: [
            { value: 2, used: 0 },
            { value: 1024, by: 'ram', used: 0 }
        ],
        small: [ { value: 3 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, true);
});


test('allowProvision - no tenant/no ufdsLimits/one large VM',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 976, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [
            { value: 2, used: 1 },
            { value: 1024, by: 'ram', used: 976 }
        ],
        small: [ { value: 3 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, false);
});


test('allowResize - no tenant/no ufdsLimits/one smaller VM',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 976, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [
            { value: 2, used: 1 },
            { value: 1024, by: 'ram', used: 976 }
        ],
        small: [ { value: 3 } ]
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowResize - no tenant/no ufdsLimits/one larger VM',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 1026, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [
            { value: 2, used: 1 },
            { value: 1024, by: 'ram', used: 1026 }
        ],
        small: [ { value: 3 } ]
    };
    var pkg = {
        max_physical_memory: 1025,
        quota: 10
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, pkg, fields, false);
});


test('allowProvision - tenant/no ufdsLimits/no VM',
function (t) {
    var fields = 'ram';
    var tenant = 'small';
    var ufdsLimits = [];
    var vms = [];
    var cfg = {
        defaults: [ { value: 2 }, { value: 1024, by: 'ram' } ],
        small: [ { value: 3, used: 0 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, true);
});


test('allowProvision - tenant/no ufdsLimits/two large VMs',
function (t) {
    var fields = 'ram';
    var tenant = 'small';
    var ufdsLimits = [];
    var vms = [
        { ram: 976, uuid: UUID1 },
        { ram: 976, uuid: UUID2 }
    ];
    var cfg = {
        defaults: [ { value: 2 }, { value: 1024, by: 'ram' } ],
        small: [ { value: 3, used: 2 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, true);
});


test('allowProvision - no tenant/ufdsLimits/three VMs',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [
        {
            datacenter: API.datacenterName,
            limit: '{"value": 4, "used": 3}'
        }
    ];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 },
        { ram: 256, uuid: UUID3 }
    ];
    var cfg = {
        defaults: [ { value: 2, used: 3 } ],
        small: [ { value: 3 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, true);
});


test('allowProvision - no tenant/ufdsLimits/four VMs',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [
        {
            datacenter: API.datacenterName,
            limit: '{"value": 4, "used": 4}'
        }
    ];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 },
        { ram: 256, uuid: UUID3 },
        { ram: 256, uuid: UUID4 }
    ];
    var cfg = {
        defaults: [ { value: 2, used: 4 } ],
        small: [ { value: 3 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, false);
});


// should allow resizes even if we're over a max num of VMs, since the num of
// VMs has nothing to do with VM size itself
test('allowResize - no tenant/ufdsLimits/four VMs',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [
        {
            datacenter: API.datacenterName,
            limit: '{"value": 3, "used": 4}'
        }
    ];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 },
        { ram: 256, uuid: UUID3 },
        { ram: 256, uuid: UUID4 }
    ];
    var cfg = {
        defaults: [ { value: 2, used: 4 } ],
        small: [ { value: 3 } ]
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowProvision - no tenant/different DC ufdsLimits/three VMs',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [
        { datacenter: 'lostinspaaace', limit: '{"value": 4}' }
    ];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 },
        { ram: 256, uuid: UUID3 }
    ];
    var cfg = {
        defaults: [ { value: 2, used: 3 } ],
        small: [ { value: 3 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, false);
});


// should allow resizes even if we're over a max num of VMs, since the num of
// VMs has nothing to do with VM size itself
test('allowResize - no tenant/different DC ufdsLimits/three VMs',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [
        { datacenter: 'lostinspaaace', limit: '{"value": 4}' }
    ];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 },
        { ram: 256, uuid: UUID3 }
    ];
    var cfg = {
        defaults: [ { value: 2, used: 3 } ],
        small: [ { value: 3 } ]
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowProvision - tenant/multiple ufdsLimits/three VMs',
function (t) {
    var fields = 'ram';
    var tenant = 'small';
    var ufdsLimits = [ {
        datacenter: API.datacenterName,
        limit: [
            '{"value": 4, "used": 3}',
            '{"value": 2000, "by": "ram", "used": 768}'
        ]
    } ];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 },
        { ram: 256, uuid: UUID3 }
    ];
    var cfg = {
        defaults: []
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, true);
});


test('allowResize - tenant/multiple ufdsLimits/three VMs',
function (t) {
    var fields = 'ram';
    var tenant = 'small';
    var ufdsLimits = [ {
        datacenter: API.datacenterName,
        limit: [
            '{"value": 4, "used": 3}',
            '{"value": 2000, "by": "ram", "used": 768}'
        ]
    } ];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 },
        { ram: 256, uuid: UUID3 }
    ];
    var cfg = {
        defaults: []
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowProvision - tenant/ufdsLimits/four VMs',
function (t) {
    var fields = 'ram';
    var tenant = 'small';
    var ufdsLimits = [
        {
            datacenter: API.datacenterName,
            limit: '{"value": 4, "used": 4}'
        }
    ];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 },
        { ram: 256, uuid: UUID3 },
        { ram: 256, uuid: UUID4 }
    ];
    var cfg = {
        defaults: [ { value: 2 } ],
        small: [ { value: 3, used: 4 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, false);
});


// should allow resizes even if we're over a max num of VMs, since the num of
// VMs has nothing to do with VM size itself
test('allowResize - tenant/ufdsLimits/four VMs',
function (t) {
    var fields = 'ram';
    var tenant = 'small';
    var ufdsLimits = [
        {
            datacenter: API.datacenterName,
            limit: '{"value": 4, "used": 4}'
        }
    ];
    var vms = [
        { ram: 256, uuid: UUID1 },
        { ram: 256, uuid: UUID2 },
        { ram: 256, uuid: UUID3 },
        { ram: 256, uuid: UUID4 }
    ];
    var cfg = {
        defaults: [ { value: 2 } ],
        small: [ { value: 3, used: 4 } ]
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowProvision - no tenant/multiple ufdsLimits/one large VM',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [ {
        datacenter: API.datacenterName,
        limit: [
            '{"value": 4, "used": 1}',
            '{"value": 2000, "by": "ram", "used": 976}'
        ]
    } ];
    var vms = [
        { ram: 976, uuid: UUID1 }
    ];
    var cfg = {
        defaults: []
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, true);
});


test('allowResize - no tenant/multiple ufdsLimits/one large VM',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [ {
        datacenter: API.datacenterName,
        limit: [
            '{"value": 4, "used": 1}',
            '{"value": 2000, "by": "ram", "used": 976}'
        ]
    } ];
    var vms = [
        { ram: 976, uuid: UUID1 }
    ];
    var cfg = {
        defaults: []
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowProvision - no tenant/multiple ufdsLimits/two large VMs',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [ {
        datacenter: API.datacenterName,
        limit: [
            '{"value": 4, "used": 2}',
            '{"value": 2000, "by": "ram", "used": 1952}'
        ]
    } ];
    var vms = [
        { ram: 976, uuid: UUID1 },
        { ram: 976, uuid: UUID2 }
    ];
    var cfg = {
        defaults: []
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, false);
});


test('allowResize - no tenant/multiple ufdsLimits/two large VMs',
function (t) {
    var fields = 'ram';
    var tenant = undefined;
    var ufdsLimits = [ {
        datacenter: API.datacenterName,
        limit: [
            '{"value": 4, "used": 2}',
            '{"value": 2000, "by": "ram", "used": 1952}'
        ]
    } ];
    var vms = [
        { ram: 976, uuid: UUID1 },
        { ram: 976, uuid: UUID2 }
    ];
    var cfg = {
        defaults: []
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowProvision - check by quota/small VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 50, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', used: 50 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, true);
});


test('allowResize - check by quota/smaller VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 50, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', used: 50 } ]
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowResize - check by quota/larger VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 50, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', used: 50 } ]
    };
    var pkg = {
        max_physical_memory: 256,
        quota: 61 * 1024
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, pkg, fields, false);
});


test('allowProvision - check by quota/larger VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 60, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', used: 60 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, false);
});


test('allowProvision - check by quota/os wildcard/small VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 50, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', check: 'os', os: 'any',
            used: 50 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, true);
});


test('allowProvision - check by quota/os wildcard/larger VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 60, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', check: 'os', os: 'any',
            used: 60 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, false);
});


test('allowResize - check by quota/os wildcard/smaller VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 60, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', check: 'os', os: 'any',
            used: 60 } ]
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowResize - check by quota/os wildcard/larger VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 60, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', check: 'os', os: 'any',
            used: 60 } ]
    };
    var pkg = {
        max_physical_memory: 256,
        quota: 61 * 1024
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, pkg, fields, false);
});


test('allowProvision - check by quota/image wildcard/small VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 50, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', check: 'os', os: 'any',
            used: 50 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, true);
});


test('allowResize - check by quota/image wildcard/smaller VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 50, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', check: 'os', os: 'any',
            used: 50 } ]
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowResize - check by quota/image wildcard/larger VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 50, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', check: 'os', os: 'any',
            used: 50 } ]
    };
    var pkg = {
        max_physical_memory: 256,
        quota: 61 * 1024
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, pkg, fields, false);
});


test('allowProvision - check by quota/image wildcard/larger VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 60, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', check: 'os', os: 'any',
            used: 60 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, false);
});


test('allowProvision - check by quota/brand wildcard/small VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 50, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', check: 'brand', brand: 'any',
            used: 50 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, true);
});


test('allowResize - check by quota/brand wildcard/smaller VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 50, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', check: 'brand', brand: 'any',
            used: 50 } ]
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, PKG, fields, true);
});


test('allowResize - check by quota/brand wildcard/larger VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 50, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', check: 'brand', brand: 'any',
            used: 50 } ]
    };
    var pkg = {
        max_physical_memory: 256,
        quota: 61 * 1024
    };

    check1_resize(t, cfg, ufdsLimits, tenant, vms[0], vms, pkg, fields, false);
});


test('allowProvision - check by quota/brand wildcard/larger VM',
function (t) {
    var fields = 'quota';
    var tenant = undefined;
    var ufdsLimits = [];
    var vms = [
        { ram: 256, quota: 60, uuid: UUID1 }
    ];
    var cfg = {
        defaults: [ { value: 60, by: 'quota', check: 'brand', brand: 'any',
            used: 60 } ]
    };

    check1_provision(t, cfg, ufdsLimits, tenant, vms, PKG, fields, false);
});


test('allowProvision - count/os/one VM',
function (t) {
    var vms = [ { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 } ];
    var limits = [
        { value: 2, check: 'os', os: 'other', used: 1 }
    ];

    function listImages(opts, cb) {
        t.deepEqual(opts, {
            state: 'all',
            os: 'other',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, true);
});


test('allowProvision - count/os/two VMs',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 },
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID2 }
    ];
    var limits = [
        { value: 2, check: 'os', os: 'other', used: 2 }
    ];

    function listImages(opts, cb) {
        t.deepEqual(opts, {
            state: 'all',
            os: 'other',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, false);
});


// should allow resizes even if we're over a max num of VMs, since the num of
// VMs has nothing to do with VM size itself
test('allowResize - count/os/three VMs',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 },
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID2 },
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID3 }
    ];
    var limits = [
        { value: 2, check: 'os', os: 'other', used: 3 }
    ];

    function listImages(opts, cb) {
        t.deepEqual(opts, {
            state: 'all',
            os: 'other',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_resize(t, limits, vms[0], vms, listImages, true);
});


test('allowProvision - count/different os/one VM',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 }
    ];
    var limits = [
        { value: 2, check: 'os', os: 'smartos', used: 0 }
    ];

    // The listImages function should only get called once via
    // checkProvisionLimits, as allowProvision will already filter the limit out
    // (i.e. allowProvision doesn't look up images at all).
    var callCount = 0;
    function listImages(opts, cb) {
        t.equal(callCount, 0, 'should be only be called once');
        callCount += 1;
        t.deepEqual(opts, {
            state: 'all',
            os: 'smartos',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, true);
});


test('allowProvision - count/os/one VM same OS',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 },
        { ram: 256, image_uuid: 'd26e2a4c-bfb8-11e7-a0eb-28cfe91f7d53',
            uuid: UUID2 }
    ];
    var limits = [
        { value: 2, check: 'os', os: 'other', used: 1 }
    ];

    function listImages(opts, cb) {
        t.deepEqual(opts, {
            state: 'all',
            os: 'other',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, true);
});


test('allowResize - count/os/one VM same OS',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 },
        { ram: 256, image_uuid: 'd26e2a4c-bfb8-11e7-a0eb-28cfe91f7d53',
            uuid: UUID2 }
    ];
    var limits = [
        { value: 2, check: 'os', os: 'other', used: 1 }
    ];

    function listImages(opts, cb) {
        t.deepEqual(opts, {
            state: 'all',
            os: 'other',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_resize(t, limits, vms[0], vms, listImages, true);
});


test('allowProvision - ram/os/one VM',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 }
    ];
    var limits = [
        { value: 512, by: 'ram', check: 'os', os: 'other', used: 256 }
    ];

    function listImages(opts, cb) {
        t.deepEqual(opts, {
            state: 'all',
            os: 'other',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, true);
});


test('allowProvision - ram/os/two VMs',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 },
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID2 }
    ];
    var limits = [
        { value: 512, by: 'ram', check: 'os', os: 'other', used: 512 }
    ];

    function listImages(opts, cb) {
        t.deepEqual(opts, {
            state: 'all',
            os: 'other',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, false);
});


test('allowResize - ram/os/two VMs',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 },
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID2 }
    ];
    var limits = [
        { value: 512, by: 'ram', check: 'os', os: 'other', used: 512 }
    ];

    function listImages(opts, cb) {
        t.deepEqual(opts, {
            state: 'all',
            os: 'other',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_resize(t, limits, vms[0], vms, listImages, true);
});



test('allowProvision - count/image/one VM',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 }
    ];
    var limits = [
        { value: 2, check: 'image', image: 'testimage', used: 1 }
    ];

    function listImages(opts, cb) {
        t.deepEqual(opts, {
            state: 'all',
            name: 'testimage',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, true);
});


test('allowProvision - count/image/two VMs',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 },
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID2 }
    ];
    var limits = [
        { value: 2, check: 'image', image: 'testimage', used: 2 }
    ];

    function listImages(opts, cb) {
        t.deepEqual(opts, {
            state: 'all',
            name: 'testimage',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, false);
});


test('allowProvision - count/different image/one VM',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 }
    ];
    var limits = [
        { value: 2, check: 'image', image: 'definitelynotwhatyouwant', used: 0 }
    ];

    // The listImages function should only get called once via
    // checkProvisionLimits, as allowProvision will already filter the limit out
    // (i.e. allowProvision doesn't look up images at all).
    var callCount = 0;
    function listImages(opts, cb) {
        t.equal(callCount, 0, 'should be only be called once');
        callCount += 1;
        t.deepEqual(opts, {
            state: 'all',
            name: 'definitelynotwhatyouwant',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, true);
});


test('allowProvision - count/image/one VM same image',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 },
        { ram: 256, image_uuid: 'd26e2a4c-bfb8-11e7-a0eb-28cfe91f7d53' }
    ];
    var limits = [
        { value: 2, check: 'image', image: 'testimage', used: 1 }
    ];

    function listImages(opts, cb) {
        t.deepEqual(opts, {
            state: 'all',
            name: 'testimage',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, true);
});


test('allowProvision - ram/image/one VM',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 }
    ];
    var limits = [
        { value: 512, by: 'ram', check: 'image', image: 'testimage', used: 256 }
    ];

    function listImages(opts, cb) {
        t.deepEqual(opts, {
            state: 'all',
            name: 'testimage',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, true);
});


test('allowProvision - ram/image/two VMs',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID1 },
        { ram: 256, image_uuid: IMAGE.uuid, uuid: UUID2 }
    ];
    var limits = [
        { value: 512, by: 'ram', check: 'image', image: 'testimage', used: 512 }
    ];

    function listImages(opts, cb) {
        t.deepEqual(opts, {
            state: 'all',
            name: 'testimage',
            req_id: '8882779e-f9ab-11e7-a697-93c18b2a37ef'
        }, 'opts');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, false);
});


test('allowProvision - count/brand/one VM',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, brand: 'lx', uuid: UUID1 }
    ];
    var limits = [
        { value: 2, check: 'brand', brand: 'lx', used: 1 }
    ];

    function listImages(_, cb) {
        t.fail('listImages() should not be called');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, true);
});


test('allowProvision - count/brand/two VMs',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, brand: 'lx', uuid: UUID1 },
        { ram: 256, image_uuid: IMAGE.uuid, brand: 'lx', uuid: UUID2 }
    ];
    var limits = [
        { value: 2, check: 'brand', brand: 'lx', used: 2 }
    ];

    function listImages(_, cb) {
        t.fail('listImages() should not be called');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, false);
});


test('allowProvision - count/different brand/one VM',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, brand: 'lx', uuid: UUID1 }
    ];
    var limits = [
        { value: 2, check: 'brand', brand: 'joyent', used: 0 }
    ];

    function listImages(_, cb) {
        t.fail('listImages() should not be called');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, true);
});


test('allowProvision - count/brand/one VM same brand',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, brand: 'lx', uuid: UUID1 },
        { ram: 256, image_uuid: 'd26e2a4c-bfb8-11e7-a0eb-28cfe91f7d53',
            brand: 'joyent', uuid: UUID2 }
    ];
    var limits = [
        { value: 2, check: 'brand', brand: 'lx', used: 1 }
    ];

    function listImages(_, cb) {
        t.fail('listImages() should not be called');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, true);
});


test('allowProvision - ram/brand/one VM',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, brand: 'lx', uuid: UUID1 }
    ];
    var limits = [
        { value: 512, by: 'ram', check: 'brand', brand: 'lx', used: 256 }
    ];

    function listImages(_, cb) {
        t.fail('listImages() should not be called');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, true);
});


test('allowProvision - ram/brand/two VMs',
function (t) {
    var vms = [
        { ram: 256, image_uuid: IMAGE.uuid, brand: 'lx', uuid: UUID1 },
        { ram: 256, image_uuid: IMAGE.uuid, brand: 'lx', uuid: UUID2 }
    ];
    var limits = [
        { value: 512, by: 'ram', check: 'brand', brand: 'lx', used: 512 }
    ];

    function listImages(_, cb) {
        t.fail('listImages() should not be called');
        cb(null, [IMAGE]);
    }

    check2_provision(t, limits, vms, listImages, false);
});


test('_convertFromCapi',
function (t) {
    var convertFromCapi = plugin._convertFromCapi;

    var result = convertFromCapi(API.log, undefined);
    t.deepEqual(result, []);

    result = convertFromCapi(API.log, { limit: '{ "value": 2 }' });
    t.deepEqual(result, [ { value: 2 } ]);

    result = convertFromCapi(API.log, {
        limit: [
            '{ "value": 2 }',
            'badjson',
            '{ "value": 25, "by": "quota" }'
        ]
    });
    t.deepEqual(result, [
        { value: 2 },
        { value: 25, by: 'quota' }
    ]);

    t.end();
});


test('_atoiValues',
function (t) {
    var atoiValues = plugin._atoiValues;

    var result = atoiValues([
        { value: 25, by: 'ram' },
        { value: 1, by: 'ram' },
        { value: -1, by: 'quota' },
        { value: '25', by: 'quota' },
        { value: 'xxxx', by: 'count' },
        { value: '-1' }
    ]);

    t.deepEqual(result, [
        { value: 25, by: 'ram' },
        { value: 1, by: 'ram' },
        { value: -1, by: 'quota' },
        { value: 25, by: 'quota' },
        { value: 0, by: 'count' },
        { value: -1 }
    ], 'atoiValues limits');

    t.end();
});


test('_getBrand',
function (t) {
    var getBrand = plugin._getBrand;

    var result = getBrand({
        requirements: { brand: 'foo' },
        type: 'docker'
    });
    t.equal(result, 'foo', 'getBrand results');

    result = getBrand({ type: 'docker' });
    t.equal(result, 'lx', 'getBrand results');

    result = getBrand({ type: 'lx-dataset' });
    t.equal(result, 'lx', 'getBrand results');

    result = getBrand({ type: 'zone-dataset' });
    t.equal(result, 'joyent', 'getBrand results');

    result = getBrand({ type: 'zvol' });
    t.equal(result, 'kvm', 'getBrand results');

    result = getBrand({ type: 'foo' });
    t.equal(result, undefined, 'getBrand results');

    t.end();
});


test('_findMinimalFields',
function (t) {
    var findMinimalFields = plugin._findMinimalFields;

    var result = findMinimalFields([
        { value: 256, by: 'ram' },
        { value: 256, by: 'ram' }
    ]);
    t.deepEqual(result, 'ram', 'findMinimalFields results');

    result = findMinimalFields([
        { value: 256, by: 'ram' },
        { value: 256, by: 'ram' },
        { value: 60, by: 'quota' }
    ]);
    t.deepEqual(result, 'ram,quota', 'findMinimalFields results');

    result = findMinimalFields([
        { value: 60, by: 'quota' },
        { value: 60, by: 'quota' }
    ]);
    t.deepEqual(result, 'quota', 'findMinimalFields results');

    result = findMinimalFields([
        { value: 60, by: 'quota' },
        { value: 5, check: 'os' }
    ]);
    t.deepEqual(result, undefined, 'findMinimalFields results');

    result = findMinimalFields([
        { value: 60, by: 'quota' },
        { value: 5, check: 'image' }
    ]);
    t.deepEqual(result, undefined, 'findMinimalFields results');

    t.end();
});
