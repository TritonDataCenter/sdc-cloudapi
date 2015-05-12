/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Test helpers for common setup tasks
 */

var common = require('./common');



// --- Exports


var PACKAGES = {
    sdc_128_ok: {
        uuid: '897779dc-9ce7-4042-8879-a4adccc94353',
        name: 'sdc_128_ok',
        version: '1.0.0',
        max_physical_memory: 128,
        quota: 10240,
        max_swap: 512,
        cpu_cap: 150,
        max_lwps: 1000,
        zfs_io_priority: 10,
        fss: 25,
        'default': false,
        vcpus: 1,
        active: true
    },

    sdc_256_inactive: {
        uuid: '4633473b-aae9-466b-8bde-3c410e5072cc',
        name: 'sdc_256_inactive',
        version: '1.0.0',
        max_physical_memory: 256,
        quota: 10240,
        max_swap: 512,
        cpu_cap: 150,
        max_lwps: 1000,
        zfs_io_priority: 10,
        'default': false,
        vcpus: 1,
        active: false
    }
};



function getBaseDataset(t, client, callback) {
    client.get('/my/datasets?name=base', function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets error');
        t.equal(res.statusCode, 200, 'GET /my/datasets status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets body');
        t.ok(Array.isArray(body), 'GET /my/datasets body is an array');
        t.ok(body.length, 'GET /my/datasets body array has elements');

        var dataset;
        body.forEach(function (d) {
            if (d.version && d.version === '13.4.0') {
                dataset = d.id;
            }
        });

        return callback(dataset);
    });
}


function getHeadnode(t, client, callback) {
    client.cnapi.listServers(function (err, servers) {
        t.ifError(err);
        t.ok(servers);
        t.ok(Array.isArray(servers));
        t.ok(servers.length > 0);
        servers = servers.filter(function (s) {
            return (s.headnode);
        });
        t.ok(servers.length > 0);
        var headnode = servers[0];
        t.ok(headnode);

        callback(headnode);
    });
}


function getProvisionableNetwork(t, client, callback) {
    client.get('/my/networks', function (err, req, res, body) {
        t.ifError(err, 'GET /my/networks error');
        t.equal(res.statusCode, 200, 'GET /my/networks status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/networks body');
        t.ok(Array.isArray(body), 'GET /my/networks body is an array');
        t.ok(body.length, 'GET /my/networks body array has elements');

        var net;
        if (body) {
            net = body[0];
        }

        return callback(net);
    });
}



module.exports = {
    getBaseDataset: getBaseDataset,
    getHeadnode: getHeadnode,
    getProvisionableNetwork: getProvisionableNetwork,
    packages: PACKAGES
};
