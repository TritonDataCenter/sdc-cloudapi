/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

var bunyan = require('bunyan');
var clients = require('sdc-clients');
var fs = require('fs');
var restify = require('restify');
var test = require('tape').test;

var PluginManager = require('../../lib/plugin-manager');



// --- Globals


var CONFIG_PATH = __dirname + '/../../etc/cloudapi.cfg';

var CLIENTS;
var CONFIG;
var LOG;
var ACCOUNT;


// --- Helpers


function getManager() {
    return new PluginManager({
        clients: CLIENTS,
        config: CONFIG,
        log: LOG
    });
}


// --- Tests


test('setup',
function (t) {
    LOG = new bunyan.createLogger({
        level: process.env.LOG_LEVEL || 'warn',
        name: 'plugintest',
        stream: process.stderr,
        serializers: restify.bunyan.serializers
    });

    CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

    var imgapi = new clients.IMGAPI({
        url: process.env.IMGAPI_URL || CONFIG.imgapi.url,
        retry: { retries: 1, minTimeout: 1000 },
        log: LOG,
        agent: false
    });

    var napi = new clients.NAPI({
        url: process.env.NAPI_URL || CONFIG.napi.url,
        retry: { retries: 1, minTimeout: 1000 },
        log: LOG,
        agent: false
    });

    var vmapi = new clients.VMAPI({
        url: process.env.VMAPI_URL || CONFIG.vmapi.url,
        retry: { retries: 1, minTimeout: 1000 },
        log: LOG,
        agent: false
    });

    CLIENTS = {
        imgapi: imgapi,
        napi: napi,
        vmapi: vmapi
    };

    vmapi.listVms({ state: 'active' }, function listVmsCb(err, vms) {
        t.ifErr(err, 'err');

        ACCOUNT = { uuid: vms[0].owner_uuid };
        t.ok(ACCOUNT.uuid, 'ACCOUNT.uuid');

        t.end();
    });
});


test('API - constants',
function (t) {
    var manager = getManager();

    t.ok(CONFIG.datacenter_name, 'CONFIG.datacenter_name');
    t.deepEqual(manager.api.datacenterName, CONFIG.datacenter_name, 'DC name');
    t.deepEqual(manager.api.log, LOG, 'log');
    t.deepEqual(manager.api.service, 'cloudapi', 'service');
    t.ok(manager.api.NotAuthorizedError, 'NotAuthorizedError');

    t.end();
});


test('API - getNapiNetworksForAccount',
function (t) {
    var manager = getManager();

    manager.api.getNapiNetworksForAccount({
        account: ACCOUNT,
        req_id: '541908ea-f804-11e7-a291-9f547787b0f5'
    }, function (err, networks) {
        t.ifErr(err, 'err');

        var badNets = networks.filter(function checkOwnerUuid(net) {
            return !net.owner_uuid;
        }).filter(function checkOwnerUuids(net) {
            return net.owner_uuids &&
                net.owner_uuids.indexOf(ACCOUNT.uuid) == -1;
        });

        t.deepEqual(badNets, [], 'no unexpected networks');

        t.end();
    });
});


test('API - getNapiNetworksForAccount badargs',
function (t) {
    var manager = getManager();

    try {
        manager.api.getNapiNetworksForAccount({
            req_id: '541908ea-f804-11e7-a291-9f547787b0f5'
        }, function () {});

        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.name, 'AssertionError', 'assertion');
        t.deepEqual(e.operator, '===', 'assertion check');
        t.deepEqual(e.expected, 'object', 'assertion expected');
        t.deepEqual(e.actual, 'undefined', 'assertion actual');
    }

    try {
        manager.api.getNapiNetworksForAccount({
            account: ACCOUNT
        }, function () {});

        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.name, 'AssertionError', 'assertion');
        t.deepEqual(e.operator, 'isUUID', 'assertion check');
        t.deepEqual(e.expected, 'uuid', 'assertion expected');
        t.deepEqual(e.actual, 'undefined', 'assertion actual');
    }

    t.end();
});


test('API - getActiveVmsForAccount',
function (t) {
    var manager = getManager();

    manager.api.getActiveVmsForAccount({
        account: ACCOUNT,
        req_id: '541908ea-f804-11e7-a291-9f547787b0f5'
    }, function getActiveCb(err, vms) {
        t.ifErr(err, 'err');

        CLIENTS.vmapi.listVms({
            owner_uuid: ACCOUNT.uuid,
            state: 'active'
        }, function listVmsCb(err2, vmapiVms) {
            t.ifErr(err2, 'err2');
            t.deepEqual(vms, vmapiVms, 'vms');
            t.end();
        });
    });
});


test('API - getActiveVmsForAccount with brand',
function (t) {
    var manager = getManager();

    manager.api.getActiveVmsForAccount({
        account: ACCOUNT,
        req_id: '541908ea-f804-11e7-a291-9f547787b0f5',
        brand: 'joyent'
    }, function getActiveCb(err, vms) {
        t.ifErr(err, 'err');

        CLIENTS.vmapi.listVms({
            owner_uuid: ACCOUNT.uuid,
            state: 'active',
            brand: 'joyent'
        }, function listVmsCb(err2, vmapiVms) {
            t.ifErr(err2, 'err2');
            t.deepEqual(vms, vmapiVms, 'vms');
            t.end();
        });
    });
});


test('API - getActiveVmsForAccount with fields',
function (t) {
    var manager = getManager();

    manager.api.getActiveVmsForAccount({
        account: ACCOUNT,
        req_id: '541908ea-f804-11e7-a291-9f547787b0f5',
        fields: 'uuid,alias'
    }, function getActiveCb(err, vms) {
        t.ifErr(err, 'err');

        CLIENTS.vmapi.listVms({
            owner_uuid: ACCOUNT.uuid,
            state: 'active',
            fields: 'uuid,alias'
        }, function listVmsCb(err2, vmapiVms) {
            t.ifErr(err2, 'err2');
            t.deepEqual(vms, vmapiVms, 'vms');
            t.end();
        });
    });
});


test('API - getActiveVmsForAccount badargs',
function (t) {
    var manager = getManager();

    try {
        manager.api.getActiveVmsForAccount({
            req_id: '541908ea-f804-11e7-a291-9f547787b0f5'
        }, function () {});

        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.name, 'AssertionError', 'assertion');
        t.deepEqual(e.operator, '===', 'assertion check');
        t.deepEqual(e.expected, 'object', 'assertion expected');
        t.deepEqual(e.actual, 'undefined', 'assertion actual');
    }

    try {
        manager.api.getActiveVmsForAccount({
            account: ACCOUNT
        }, function () {});

        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.name, 'AssertionError', 'assertion');
        t.deepEqual(e.operator, 'isUUID', 'assertion check');
        t.deepEqual(e.expected, 'uuid', 'assertion expected');
        t.deepEqual(e.actual, 'undefined', 'assertion actual');
    }

    try {
        manager.api.getActiveVmsForAccount({
            account: ACCOUNT,
            req_id: '541908ea-f804-11e7-a291-9f547787b0f5',
            fields: 99
        }, function () {});

        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.name, 'AssertionError', 'assertion');
        t.deepEqual(e.operator, '===', 'assertion check');
        t.deepEqual(e.expected, 'string', 'assertion expected');
        t.deepEqual(e.actual, 'number', 'assertion actual');
    }

    try {
        manager.api.getActiveVmsForAccount({
            account: ACCOUNT,
            req_id: '541908ea-f804-11e7-a291-9f547787b0f5',
            brand: 99
        }, function () {});

        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.name, 'AssertionError', 'assertion');
        t.deepEqual(e.operator, '===', 'assertion check');
        t.deepEqual(e.expected, 'string', 'assertion expected');
        t.deepEqual(e.actual, 'number', 'assertion actual');
    }

    t.end();
});


test('API - getImage',
function (t) {
    var manager = getManager();

    CLIENTS.imgapi.listImages({}, function listImagesCb(err, images) {
        t.ifErr(err, 'err');

        manager.api.getImage({
            image: images[0],
            req_id: '541908ea-f804-11e7-a291-9f547787b0f5'
        }, function getCb(err2, img) {
            t.ifErr(err2, 'err2');
            t.deepEqual(img, images[0], 'images');
            t.end();
        });
    });
});


test('API - getImage badargs',
function (t) {
    var manager = getManager();

    try {
        manager.api.getImage('', function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts (object) is required', 'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'string', 'e.actual');
    }

    try {
        manager.api.getImage({}, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.image (object) is required', 'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.api.getImage({
            image: {}
        }, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.image.uuid (uuid) is required',
            'e.message');
        t.deepEqual(e.expected, 'uuid', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.api.getImage({
            image: { uuid: 'b55e6b0a-fa92-11e7-a7c6-37ed1ebe27f8' }
        }, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.req_id (uuid) is required', 'e.message');
        t.deepEqual(e.expected, 'uuid', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.api.getImage({
            image: { uuid: 'b55e6b0a-fa92-11e7-a7c6-37ed1ebe27f8' },
            req_id: '541908ea-f804-11e7-a291-9f547787b0f5'
        });
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'cb (func) is required', 'e.message');
        t.deepEqual(e.expected, 'func', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    t.end();
});


test('API - listImage',
function (t) {
    var manager = getManager();

    CLIENTS.imgapi.listImages({}, function listImagesCb(err, images) {
        t.ifErr(err, 'err');

        manager.api.listImages({
            req_id: 'b8cca400-f9ca-11e7-8a6e-83fc53229350'
        }, function listCb(err2, imgs) {
            t.ifErr(err2, 'err2');
            t.deepEqual(imgs, images, 'images');
            t.end();
        });
    });
});


test('API - listImage badargs',
function (t) {
    var manager = getManager();

    try {
        manager.api.listImages(undefined, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts (object) is required', 'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.api.listImages({},  undefined);
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.req_id (uuid) is required', 'e.message');
        t.deepEqual(e.expected, 'uuid', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }


    try {
        manager.api.listImages({
            req_id: 'b8cca400-f9ca-11e7-8a6e-83fc53229350'
        },  undefined);
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'cb (func) is required', 'e.message');
        t.deepEqual(e.expected, 'func', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    t.end();
});


test('filterListNetworks',
function (t) {
    var manager = getManager();

    var called = 0;
    manager.hooks.filterListNetworks = [
        function (opts, nets) {
            called += 1;
            t.deepEqual({ account: {} }, opts, 'opts');
            t.deepEqual(nets, [1, 2, 3], 'nets');
            return [1, 2];
        },
        function (opts, nets) {
            called += 1;
            t.deepEqual({ account: {} }, opts, 'opts');
            t.deepEqual(nets, [1, 2], 'nets');
            return [1, 2];
        }
    ];

    var networks = manager.filterListNetworks({ account: {} }, [1, 2, 3]);
    t.deepEqual(networks, [1, 2], 'networks');
    t.equal(called, 2, 'both funcs called');

    t.end();
});


test('filterListNetworks - no plugins',
function (t) {
    var manager = getManager();
    manager.hooks.filterListNetworks = [];

    var nets = manager.filterListNetworks({ account: {} }, [1, 2, 3]);
    t.deepEqual(nets, [1, 2, 3], 'no filtering');
    t.end();
});


test('filterListNetworks - badargs',
function (t) {
    var manager = getManager();

    try {
        manager.filterListNetworks(undefined, [1, 2, 3]);
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts (object) is required', 'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.filterListNetworks({}, [1, 2, 3]);
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.account (object) is required',
            'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }


    try {
        manager.filterListNetworks({ account: {} }, undefined);
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'networks (array) is required', 'e.message');
        t.deepEqual(e.expected, 'array', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    t.end();
});


test('filterGetNetworksOrPools',
function (t) {
    var manager = getManager();

    var called = 0;
    manager.hooks.filterGetNetworksOrPools = [
        function (opts, nets) {
            called += 1;
            t.deepEqual({ account: {} }, opts, 'opts');
            t.deepEqual(nets, [1, 2, 3], 'nets');
            return [1, 2];
        },
        function (opts, nets) {
            called += 1;
            t.deepEqual({ account: {} }, opts, 'opts');
            t.deepEqual(nets, [1, 2], 'nets');
            return [1, 2];
        }
    ];

    var networks = manager.filterGetNetworksOrPools({ account: {} }, [1, 2, 3]);
    t.deepEqual(networks, [1, 2], 'networks');
    t.equal(called, 2, 'both funcs called');

    t.end();
});


test('filterGetNetworksOrPools - no plugins',
function (t) {
    var manager = getManager();
    manager.hooks.filterGetNetworksOrPools = [];

    var nets = manager.filterGetNetworksOrPools({ account: {} }, [1, 2, 3]);
    t.deepEqual(nets, [1, 2, 3], 'no filtering');
    t.end();
});


test('filterGetNetworksOrPools - badargs',
function (t) {
    var manager = getManager();

    try {
        manager.filterGetNetworksOrPools(undefined, [1, 2, 3]);
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts (object) is required', 'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.filterGetNetworksOrPools({}, [1, 2, 3]);
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.account (object) is required',
            'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.filterGetNetworksOrPools({ account: {} }, undefined);
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'networks (array) is required', 'e.message');
        t.deepEqual(e.expected, 'array', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    t.end();
});


test('findOwnerExternalNetwork',
function (t) {
    var manager = getManager();

    var called = 0;
    manager.hooks.findOwnerExternalNetwork = [
        function (opts, next) {
            called += 1;
            t.deepEqual(opts, {
                account: {},
                req_id: '03a19052-f9e0-11e7-bc63-1b41742f3bd0'
            }, 'opts');
            t.equal(typeof (next), 'function', 'next');
            next(new Error());
        },
        function (opts, next) {
            called += 1;
            t.deepEqual(opts, {
                account: {},
                req_id: '03a19052-f9e0-11e7-bc63-1b41742f3bd0'
            }, 'opts');
            t.equal(typeof (next), 'function', 'next');
            next(null, { test: true });
        },
        function (opts, next) {
            called += 1;
            t.fail('code should be unreachable');
            next();
        }
    ];

    manager.findOwnerExternalNetwork({
        account: {},
        req_id: '03a19052-f9e0-11e7-bc63-1b41742f3bd0'
    }, function extCb(err, net) {
        t.deepEqual(net, { test: true }, 'networks');
        t.equal(called, 2, 'two funcs called');
        t.end();
    });
});


test('findOwnerExternalNetwork - no plugins',
function (t) {
    var manager = getManager();
    manager.hooks.findOwnerExternalNetwork = [];

    manager.findOwnerExternalNetwork({
        account: {},
        req_id: '03a19052-f9e0-11e7-bc63-1b41742f3bd0'
    }, function extCb(err, net) {
        t.ifErr(err, 'err');
        t.equal(net, undefined, 'net');
        t.end();
    });
});


test('findOwnerExternalNetwork - badargs',
function (t) {
    var manager = getManager();

    try {
        manager.findOwnerExternalNetwork(undefined, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts (object) is required', 'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.findOwnerExternalNetwork({}, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.account (object) is required',
            'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.findOwnerExternalNetwork({
            account: {}
        }, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.req_id (uuid) is required',
            'e.message');
        t.deepEqual(e.expected, 'uuid', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }


    try {
        manager.findOwnerExternalNetwork({
            account: {},
            req_id: '03a19052-f9e0-11e7-bc63-1b41742f3bd0'
        }, undefined);
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'cb (func) is required', 'e.message');
        t.deepEqual(e.expected, 'func', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    t.end();
});


test('allowProvision - pass',
function (t) {
    var manager = getManager();

    var called = 0;
    manager.hooks.allowProvision = [
        function (opts, next) {
            called += 1;
            t.deepEqual(opts, {
                account: {},
                image: {},
                pkg: {},
                req_id: '03a19052-f9e0-11e7-bc63-1b41742f3bd0'
            }, 'opts');
            t.equal(typeof (next), 'function', 'next');
            next();
        },
        function (opts, next) {
            called += 1;
            t.deepEqual(opts, {
                account: {},
                image: {},
                pkg: {},
                req_id: '03a19052-f9e0-11e7-bc63-1b41742f3bd0'
            }, 'opts');
            t.equal(typeof (next), 'function', 'next');
            next();
        }
    ];

    manager.allowProvision({
        account: {},
        image: {},
        pkg: {},
        req_id: '03a19052-f9e0-11e7-bc63-1b41742f3bd0'
    }, function extCb(err) {
        t.ifErr(err, 'err');
        t.equal(called, 2, 'two funcs called');
        t.end();
    });
});


test('allowProvision - fail',
function (t) {
    var manager = getManager();

    var called = 0;
    manager.hooks.allowProvision = [
        function (opts, next) {
            called += 1;
            t.deepEqual(opts, {
                account: {},
                image: {},
                pkg: {},
                req_id: '03a19052-f9e0-11e7-bc63-1b41742f3bd0'
            }, 'opts');
            t.equal(typeof (next), 'function', 'next');
            next(new Error());
        },
        function (opts, next) {
            called += 1;
            t.fail('code should be unreachable');
            next();
        }
    ];

    manager.allowProvision({
        account: {},
        image: {},
        pkg: {},
        req_id: '03a19052-f9e0-11e7-bc63-1b41742f3bd0'
    }, function extCb(err) {
        t.ok(err, 'err');
        t.equal(called, 1, 'one func called');
        t.end();
    });
});


test('allowProvision - no plugins',
function (t) {
    var manager = getManager();
    manager.hooks.allowProvision = [];

    manager.allowProvision({
        account: {},
        image: {},
        pkg: {},
        req_id: '03a19052-f9e0-11e7-bc63-1b41742f3bd0'
    }, function extCb(err) {
        t.ifErr(err, 'err');
        t.end();
    });
});


test('allowProvision - badargs',
function (t) {
    var manager = getManager();

    try {
        manager.allowProvision(undefined, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts (object) is required', 'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.allowProvision({}, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.account (object) is required',
            'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.allowProvision({
            account: {}
        }, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.image (object) is required', 'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.allowProvision({
            account: {},
            image: {}
        }, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.pkg (object) is required', 'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.allowProvision({
            account: {},
            image: {},
            pkg: {}
        }, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.req_id (uuid) is required', 'e.message');
        t.deepEqual(e.expected, 'uuid', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.allowProvision({
            account: {},
            image: {},
            pkg: {},
            req_id: '03a19052-f9e0-11e7-bc63-1b41742f3bd0'
        }, undefined);
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'cb (func) is required', 'e.message');
        t.deepEqual(e.expected, 'func', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    t.end();
});


test('postProvision',
function (t) {
    var manager = getManager();

    var called = 0;
    manager.hooks.postProvision = [
        function (opts, next) {
            called += 1;
            next(new Error());
        },
        function (opts, next) {
            called += 1;
            next();
        }
    ];

    manager.postProvision({
        account: {},
        instance: {},
        req_id: '06ad0a72-f983-11e7-b781-63a5e1be85ea'
    }, function extCb(err) {
        t.ifErr(err, 'err');
        t.equal(called, 2, 'two funcs called');
        t.end();
    });
});


test('postProvision - no plugins',
function (t) {
    var manager = getManager();
    manager.hooks.postProvision = [];

    manager.postProvision({
        account: {},
        instance: {},
        req_id: '06ad0a72-f983-11e7-b781-63a5e1be85ea'
    }, function extCb(err) {
        t.ifErr(err, 'err');
        t.end();
    });
});


test('postProvision - badargs',
function (t) {
    var manager = getManager();

    try {
        manager.postProvision(undefined, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts (object) is required', 'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.postProvision({
        }, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.account (object) is required',
            'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.postProvision({
            account: {}
        }, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.instance (object) is required',
            'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.postProvision({
            account: {}
        }, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.instance (object) is required',
            'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.postProvision({
            account: {},
            instance: {}
        }, function () {});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.req_id (uuid) is required', 'e.message');
        t.deepEqual(e.expected, 'uuid', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.postProvision({
            account: {},
            instance: {},
            req_id: '06ad0a72-f983-11e7-b781-63a5e1be85ea'
        }, undefined);
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'cb (func) is required', 'e.message');
        t.deepEqual(e.expected, 'func', 'assertion expected');
        t.deepEqual(e.actual, 'undefined', 'assertion actual');
    }

    t.end();
});


test('modifyProvisionNetworks',
function (t) {
    var manager = getManager();

    var called = 0;
    manager.hooks.modifyProvisionNetworks = [
        function (opts, next) {
            called += 1;
            t.deepEqual({
                account: {},
                networks: [ {} ],
                req_id: 'f54db238-43bd-11e8-b7d1-42004d19d401'
            }, opts, 'opts');
            next();
        },
        function (opts, next) {
            called += 1;
            t.deepEqual({
                account: {},
                networks: [ {} ],
                req_id: 'f54db238-43bd-11e8-b7d1-42004d19d401'
            }, opts, 'opts');
            next();
        }
    ];

    manager.modifyProvisionNetworks({
        account: {},
        networks: [ {} ],
        req_id: 'f54db238-43bd-11e8-b7d1-42004d19d401'
    }, function extCb(err) {
        t.ifError(err, 'err');
        t.equal(called, 2, 'both funcs called');

        t.end();
    });
});


test('modifyProvisionNetworks - no plugins',
function (t) {
    var manager = getManager();
    manager.hooks.modifyProvisionNetworks = [];

    manager.modifyProvisionNetworks({
        account: {},
        networks: [ {} ],
        req_id: 'f54db238-43bd-11e8-b7d1-42004d19d401'
    }, function extCb(err) {
        t.ifError(err, 'err');
        t.end();
    });
});


test('modifyProvisionNetworks - badargs',
function (t) {
    var manager = getManager();

    try {
        manager.modifyProvisionNetworks();
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts (object) is required', 'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.modifyProvisionNetworks({});
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.account (object) is required',
            'e.message');
        t.deepEqual(e.expected, 'object', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.modifyProvisionNetworks({ account: {} });
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.networks ([object]) is required',
            'e.message');
        t.deepEqual(e.expected, '[object]', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.modifyProvisionNetworks({ account: {}, networks: [] });
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'opts.req_id (uuid) is required', 'e.message');
        t.deepEqual(e.expected, 'uuid', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    try {
        manager.modifyProvisionNetworks({
            account: {},
            networks: [],
            req_id: 'f54db238-43bd-11e8-b7d1-42004d19d401'
        });
        t.fail('exception not thrown');
    } catch (e) {
        t.deepEqual(e.message, 'cb (func) is required', 'e.message');
        t.deepEqual(e.expected, 'func', 'e.expected');
        t.deepEqual(e.actual, 'undefined', 'e.actual');
    }

    t.end();
});
