// Copyright 2014 Joyent, Inc. All rights reserved.

var fs = require('fs');
var util = require('util');
var test = require('tap').test;
var libuuid = require('libuuid');
function uuid() {
    return (libuuid.create());
}
var sprintf = util.format;
var common = require('./common');
var machinesCommon = require('./machines/common');
var checkMachine = machinesCommon.checkMachine;
var checkJob = machinesCommon.checkJob;
var waitForJob = machinesCommon.waitForJob;
var checkWfJob = machinesCommon.checkWfJob;
var waitForWfJob = machinesCommon.waitForWfJob;
var saveKey = machinesCommon.saveKey;
var addPackage = machinesCommon.addPackage;
// --- Globals

var client, server, snapshot;
var keyName = uuid();
var machine;
var image_uuid;
var KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEAvad19ePSDckmgmo6Unqmd8' +
    'n2G7o1794VN3FazVhV09yooXIuUhA+7OmT7ChiHueayxSubgL2MrO/HvvF/GGVUs/t3e0u4' +
    '5YwRC51EVhyDuqthVJWjKrYxgDMbHru8fc1oV51l0bKdmvmJWbA/VyeJvstoX+eiSGT3Jge' +
    'egSMVtc= mark@foo.local';

var TAG_KEY = 'role';
var TAG_VAL = 'unitTest';

var META_KEY = 'foo';
var META_VAL = 'bar';

var META_64_KEY = 'sixtyfour';
var META_64_VAL = new Buffer('Hello World').toString('base64');

var META_CREDS = {
    'root': 'secret',
    'admin': 'secret'
};

var META_CREDS_TWO = {
    'root': 'secret',
    'admin': 'secret',
    'jill': 'secret'
};

var TAP_CONF = {
    timeout: 'Infinity '
};


// May or not be created by previous test run or whatever else:
var sdc_256_inactive = {
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
    urn: 'sdc:4633473b-aae9-466b-8bde-3c410e5072cc:sdc_256_inactive:1.0.0',
    active: false
};

var sdc_128_ok = {
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
    urn: 'sdc:897779dc-9ce7-4042-8879-a4adccc94353:sdc_128_ok:1.0.0',
    active: true
};


var sdc_256_entry, sdc_256_inactive_entry, sdc_128_ok_entry;

var HEADNODE = null;
var account;
// --- Tests

test('setup', TAP_CONF, function (t) {
    common.setup('~7.2', function (err, _client, _server) {
        t.ifError(err, 'common setup error');
        t.ok(_client, 'common _client ok');
        client = _client;
        account = client.account.login;
        if (!process.env.SDC_SETUP_TESTS) {
            t.ok(_server);
        }
        server = _server;
        saveKey(KEY, keyName, client, t, function () {
            // Add custom packages; "sdc_" ones will be owned by admin user:
            addPackage(client, sdc_128_ok, function (err2, entry) {
                t.ifError(err2, 'Add package error');
                sdc_128_ok_entry = entry;
                addPackage(client, sdc_256_inactive, function (err3, entry2) {
                    t.ifError(err3, 'Add package error');
                    sdc_256_inactive_entry = entry2;
                    t.end();
                });
            });
        });
    });
});


test('Get Headnode', TAP_CONF, function (t) {
    client.cnapi.listServers(function (err, servers) {
        t.ifError(err);
        t.ok(servers);
        t.ok(Array.isArray(servers));
        t.ok(servers.length > 0);
        servers = servers.filter(function (s) {
            return (s.headnode);
        });
        t.ok(servers.length > 0);
        HEADNODE = servers[0];
        t.ok(HEADNODE);
        t.end();
    });
});


var DATASET;

test('get base dataset', TAP_CONF, function (t) {
    client.get('/my/datasets?name=base', function (err, req, res, body) {
        t.ifError(err, 'GET /my/datasets error');
        t.equal(res.statusCode, 200, 'GET /my/datasets status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/datasets body');
        t.ok(Array.isArray(body), 'GET /my/datasets body is an array');
        t.ok(body.length, 'GET /my/datasets body array has elements');
        body.forEach(function (d) {
            if (d.version && d.version === '13.4.0') {
                DATASET = d.id;
            }
        });
        t.end();
    });
});


var USER_FMT = 'uuid=%s, ou=users, o=smartdc';
var POLICY_FMT = 'policy-uuid=%s, ' + USER_FMT;
var ROLE_FMT = 'role-uuid=%s, ' + USER_FMT;
var A_POLICY_UUID, A_POLICY_DN, A_POLICY_NAME;
var A_ROLE_UUID, A_ROLE_DN, A_ROLE_NAME;


test('create policy', function (t) {
    var policy_uuid = libuuid.create();
    var name = 'a' + policy_uuid.substr(0, 7);

    var entry = {
        name: name,
        rules: [
            '* CAN get * IF route::string = getaccount',
            '* CAN get AND head * IF route::string = listusers',
            '* CAN post * IF route::string = createuser',
            'Foobar CAN get * IF route::string = listkeys',
            util.format('%s CAN get * IF route::string = listuserkeys',
                client.testSubUser)
        ],
        description: 'This is the account/users policy'
    };

    client.post('/my/policies', entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        A_POLICY_UUID = body.id;
        A_POLICY_NAME = body.name;
        A_POLICY_DN = util.format(POLICY_FMT, A_POLICY_UUID, account.uuid);
        t.end();
    });
});


test('create role', function (t) {
    var role_uuid = libuuid.create();
    var name = 'a' + role_uuid.substr(0, 7);

    var entry = {
        name: name,
        members: client.testSubUser,
        policies: [A_POLICY_NAME],
        default_members: client.testSubUser
    };

    client.post('/my/roles', entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        A_ROLE_UUID = body.id;
        A_ROLE_NAME = body.name;
        A_ROLE_DN = util.format(ROLE_FMT, A_ROLE_UUID, account.uuid);
        t.end();
    });
});


// Test using IMAGE.uuid instead of IMAGE.name due to PUBAPI-625:
test('CreateMachine', TAP_CONF, function (t) {
    var obj = {
        image: DATASET,
        'package': 'sdc_128_ok',
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE.uuid,
        firewall_enabled: true,
        // TODO: This should work with role names at cloudapi level, and
        // translated internally into role uuid for vmapi.
        role_tags: [A_ROLE_UUID]
    };
    obj['metadata.' + META_KEY] = META_VAL;
    obj['tag.' + TAG_KEY] = TAG_VAL;

    obj['metadata.credentials'] = META_CREDS;

    client.post('/my/machines', obj, function (err, req, res, body) {
        t.ifError(err, 'POST /my/machines error');
        t.equal(res.statusCode, 201, 'POST /my/machines status');
        common.checkHeaders(t, res.headers);
        t.equal(res.headers.location,
            util.format('/%s/machines/%s', client.testUser, body.id));
        t.ok(body, 'POST /my/machines body');
        checkMachine(t, body);
        machine = body.id;
        // Handy to output this to stdout in order to poke around COAL:
        console.log('Requested provision of machine: %s', machine);
        t.end();
    });
});


test('Wait For Running', TAP_CONF,  function (t) {
    client.vmapi.listJobs({
        vm_uuid: machine,
        task: 'provision'
    }, function (err, jobs) {
        if (err) {
            // Skip machine tests when machine creation fails
            machine = null;
        }
        t.ifError(err, 'list jobs error');
        t.ok(jobs, 'list jobs ok');
        t.ok(jobs.length, 'list jobs is an array');
        waitForJob(client, jobs[0].uuid, function (err2) {
            if (err2) {
                // Skip machine tests when machine creation fails
                machine = null;
            }
            t.ifError(err2, 'Check state error');
            t.end();
        });
    });
});


test('Get Machine', TAP_CONF, function (t) {
    if (machine) {
        client.get('/my/machines/' + machine, function (err, req, res, body) {
            t.ifError(err, 'GET /my/machines/:id error');
            t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'GET /my/machines/:id body');
            checkMachine(t, body);
            t.ok(body.compute_node, 'machine compute_node');
            t.ok(body.firewall_enabled, 'machine firewall enabled');
            t.ok(body.networks, 'machine networks');
            t.ok(Array.isArray(body.networks), 'machine networks array');
            // Double check tags are OK, due to different handling by VMAPI:
            var tags = {};
            tags[TAG_KEY] = TAG_VAL;
            t.equivalent(body.tags, tags, 'Machine tags');
            t.end();
        });
    }
});


// PENDING: would like to be able to add role-tags on machine creation:
test('Add machine role-tags until (temporary)', TAP_CONF, function (t) {
    client.vmapi.addRoleTags({
        uuid: machine,
        owner_uuid: client.account.id,
        role_tags: [ A_ROLE_UUID ]
    }, function (err, role_tags) {
        t.ifError(err);
        t.ok(role_tags);
        t.end();
    });
});



test('Get Machine', TAP_CONF, function (t) {
    if (machine) {
        client.get('/my/machines/' + machine, function (err, req, res, body) {
            t.ifError(err, 'GET /my/machines/:id error');
            t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
            common.checkHeaders(t, res.headers);
            t.ok(body, 'GET /my/machines/:id body');
            checkMachine(t, body);
            t.ok(body.compute_node, 'machine compute_node');
            t.ok(body.firewall_enabled, 'machine firewall enabled');
            t.ok(body.networks, 'machine networks');
            t.ok(Array.isArray(body.networks), 'machine networks array');
            // Double check tags are OK, due to different handling by VMAPI:
            var tags = {};
            tags[TAG_KEY] = TAG_VAL;
            t.equivalent(body.tags, tags, 'Machine tags');
            t.ok(body['role-tag']);
            t.ok(Array.isArray(body['role-tag']));
            t.equal(body['role-tag'][0], A_ROLE_NAME);
            t.end();
        });
    }
});


test('Delete tests', TAP_CONF, function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, client, machine, function () {
        t.end();
    });
});


test('teardown', {timeout: 'Infinity '}, function (t) {
    client.del('/my/keys/' + keyName, function (err, req, res) {
        t.ifError(err, 'delete key error');
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        client.teardown(function (err2) {
            // Ignore err2 here, just means we have not been able to remove
            // something from ufds.
            if (!process.env.SDC_SETUP_TESTS) {
                Object.keys(server._clients).forEach(function (c) {
                    if (typeof (server._clients[c].client) !== 'undefined' &&
                        typeof (server._clients[c].client.close) ===
                            'function') {
                        server._clients[c].client.close();
                        }
                });
                server._clients.ufds.client.removeAllListeners('close');
                server.close(function () {
                    t.end();
                });
            } else {
                t.end();
            }
        });
    });
});
