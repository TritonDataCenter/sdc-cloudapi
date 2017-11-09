/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var util = require('util');
var test = require('tape').test;
var restify = require('restify');
var httpSignature = require('http-signature');
var common = require('./common');
var waitForMahiCache = common.waitForMahiCache;
var uuid = common.uuid;
var machinesCommon = require('./machines/common');
var checkMachine = machinesCommon.checkMachine;


// --- Globals


var SDC_128 = common.sdc_128_package;

var PROVISIONABLE_NET_UUID;
var SERVER_UUID;
var IMAGE_UUID;

var ROLE_NAME;
var ROLE_UUID;

var ACCOUNT_NAME;
var MACHINE_UUID;
var SUB_MACHINE_UUID;

var CLIENTS;
var CLIENT;
var SUB_CLIENT;
var OTHER;
var SERVER;


// --- Tests


test('setup', function (t) {
    common.setup({clientApiVersion: '~7.2'}, function (_, clients, server) {
        CLIENTS = clients;
        SERVER  = server;

        CLIENT  = clients.user;
        SUB_CLIENT = clients.subuser;
        OTHER   = clients.other;

        ACCOUNT_NAME = CLIENT.account.login;

        ROLE_NAME = CLIENT.role.name;
        ROLE_UUID = CLIENT.role.uuid;

        t.end();
    });
});


test('Get test server', function (t) {
    common.getTestServer(CLIENT, function (err, testServer) {
        t.ifError(err);
        SERVER_UUID = testServer.uuid;
        t.end();
    });
});


test('Get test image', function (t) {
    common.getTestImage(CLIENT, function (err, img) {
        t.ifError(err, 'getTestImage');
        t.ok(img.id, 'img.id: ' + img.id);
        IMAGE_UUID = img.id;
        t.end();
    });
});


test('tag machines resource collection with role', function (t) {
    CLIENT.put('/my/machines', {
        'role-tag': [ROLE_NAME]
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.name, 'resource role name');
        t.ok(body['role-tag'], 'resource role tag');
        t.ok(body['role-tag'].length, 'resource role tag ary');
        t.end();
    });
});


// Test using IMAGE.uuid instead of IMAGE.name due to PUBAPI-625:
test('CreateMachine', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_128.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: SERVER_UUID,
        firewall_enabled: true
    };

    CLIENT.post({
        path: '/my/machines',
        headers: {
            'role-tag': [ROLE_NAME]
        }
    }, obj, function (err, req, res, body) {
        t.ifError(err, 'POST /my/machines error');
        t.equal(res.statusCode, 201, 'POST /my/machines status');
        common.checkHeaders(t, res.headers);
        t.equal(res.headers.location,
            util.format('/%s/machines/%s', CLIENT.login, body.id));
        t.ok(body, 'POST /my/machines body');
        checkMachine(t, body);

        MACHINE_UUID = body.id;

        // Handy to output this to stdout in order to poke around COAL:
        console.log('Requested provision of machine: %s', MACHINE_UUID);
        t.end();
    });
});


test('Wait For Running', function (t) {
    machinesCommon.waitForRunningMachine(CLIENT, MACHINE_UUID, function (err) {
        t.ifError(err);

        if (err) {
            // Skip machine tests when machine creation fails
            MACHINE_UUID = false;
        }

        t.end();
    });
});


test('Get Machine', function (t) {
    if (!MACHINE_UUID) {
        return t.end();
    }

    return CLIENT.get({
        path: '/my/machines/' + MACHINE_UUID,
        headers: {
            'role-tag': true
        }
    }, function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines/:id error');
        t.equal(res.statusCode, 200, 'GET /my/machines/:id status');

        t.ok(body, 'GET /my/machines/:id body');
        t.ok(body.compute_node, 'machine compute_node');
        t.ok(body.firewall_enabled, 'machine firewall enabled');
        t.ok(Array.isArray(body.networks), 'machine networks array');

        common.checkHeaders(t, res.headers);
        checkMachine(t, body);

        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], ROLE_NAME, 'resource role-tag');

        t.end();
    });
});


test('get provisionable network', function (t) {
    machinesCommon.getProvisionableNetwork(CLIENT, function (err, net) {
        t.ifError(err);
        PROVISIONABLE_NET_UUID = net.id;
        t.end();
    });
});


test('7.3 networks format should fail', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_128.name,
        name: 'a' + uuid().substr(0, 7),
        networks: [ { ipv4_uuid: PROVISIONABLE_NET_UUID, ipv4_count: 1 } ],
        server_uuid: SERVER_UUID
    };

    CLIENT.post({
        path: '/my/machines'
    }, obj, function (err, req, res, body) {
        t.ok(err, 'error expected');
        if (err) {
            t.equal(err.message, 'Invalid Networks', 'error message');
        }

        t.end();
    });
});


test('sub-user tests', function (t) {
    function subRequestSigner(req) {
        httpSignature.sign(req, {
            key: SUB_CLIENT.privateKey,
            keyId: SUB_CLIENT.keyId
        });
    }

    var mPath = util.format('/user/%s/%s', ACCOUNT_NAME, CLIENTS.subuser.login);

    // We need to check that mahi-replicator has caught up with our latest
    // operation, which is adding the test-role to the test sub user:
    function waitMahiReplicator(cb) {
        waitForMahiCache(CLIENT.mahi, mPath, function (er, cache) {
            if (er) {
                CLIENT.log.error({err: er}, 'Error fetching mahi resource');
                t.fail('Error fetching mahi resource');
                t.end();
            } else {
                if (!cache.roles || Object.keys(cache.roles).length === 0 ||
                    Object.keys(cache.roles).indexOf(ROLE_UUID) === -1) {
                    setTimeout(function () {
                        waitMahiReplicator(cb);
                    }, 1000);
                } else {
                    cb();
                }
            }
        });
    }


    waitMahiReplicator(function () {
        var cli = restify.createJsonClient({
            url: SERVER.url,
            retryOptions: {
                retry: 0
            },
            log: CLIENT.log,
            rejectUnauthorized: false,
            signRequest: subRequestSigner
        });

        // Need it to be able to poll jobs:
        cli.vmapi = CLIENT.vmapi;

        // Sub user tests go here, using a different client instance
        t.test('sub-user get machine', function (t1) {
            if (MACHINE_UUID) {
                cli.get({
                    path: '/' + ACCOUNT_NAME + '/machines/' + MACHINE_UUID,
                    headers: {
                        'accept-version': '~7.2',
                        'role-tag': true
                    }
                }, function (err, req, res, obj) {
                    t1.ifError(err, 'sub-user get machine error');
                    t1.equal(res.statusCode, 200, 'sub-user auth statusCode');
                    t1.ok(res.headers['role-tag'], 'resource role-tag header');
                    t1.equal(res.headers['role-tag'], ROLE_NAME,
                        'resource role-tag');
                    t1.equal(MACHINE_UUID, obj.id, 'machine uuid');
                    cli.close();
                    t1.end();
                });
            } else {
                console.log('Eh no machine!: %j', MACHINE_UUID);
                t1.end();
            }
        });

        t.test('Reboot test', function (t2) {
            var rebootTest = require('./machines/reboot');
            rebootTest(t2, cli, OTHER, MACHINE_UUID, function () {
                t2.end();
            });
        });

        // The sub-user role lacks of "POST" + 'stopmachine' route:
        t.test('Sub user cannot stop machine', function (t3) {
            cli.post({
                path: '/' + ACCOUNT_NAME + '/machines/' + MACHINE_UUID,
                headers: {
                    'accept-version': '~7.2'
                }
            }, {
                action: 'stop'
            }, function (err, req, res, obj) {
                t3.ok(err, 'sub-user get account error');
                t3.equal(res.statusCode, 403, 'sub-user auth statusCode');
                t3.end();
            });
        });

        t.test('CreateMachine', function (t4) {
            var obj = {
                image: IMAGE_UUID,
                package: SDC_128.name,
                name: 'a' + uuid().substr(0, 7),
                server_uuid: SERVER_UUID,
                firewall_enabled: true
            };

            cli.post({
                path: '/' + ACCOUNT_NAME + '/machines',
                headers: {
                    'accept-version': '~7.2'
                }
            }, obj, function (err, req, res, body) {
                t4.ifError(err, 'POST /my/machines error');
                t4.equal(res.statusCode, 201, 'POST /my/machines status');
                common.checkHeaders(t, res.headers);
                t4.equal(res.headers.location,
                    util.format('/%s/machines/%s', CLIENT.login, body.id));
                t4.ok(body, 'POST /my/machines body');
                checkMachine(t4, body);

                SUB_MACHINE_UUID = body.id;

                // Handy to output this to stdout in order to poke around COAL:
                console.log('Requested provision of machine: %s',
                            SUB_MACHINE_UUID);
                t4.end();
            });
        });

        t.test('Wait For Running', function (t5) {
            machinesCommon.waitForRunningMachine(cli, SUB_MACHINE_UUID,
                                                function (err) {
                t.ifError(err);

                if (err) {
                    // Skip machine tests when machine creation fails
                    SUB_MACHINE_UUID = false;
                }

                t5.end();
            });
        });

        t.test('Add machine role-tag', function (t6) {
            cli.put({
                path: '/' + ACCOUNT_NAME + '/machines/' + SUB_MACHINE_UUID,
                headers: {
                    'accept-version': '~7.2'
                }
            }, {
                'role-tag': [ROLE_NAME]
            }, function (err, req, res, body) {
                t6.ifError(err);
                t6.equal(res.statusCode, 200);
                t6.ok(body['role-tag']);
                t6.ok(Array.isArray(body['role-tag']));
                t6.equal(body['role-tag'][0], ROLE_NAME);
                t6.end();
            });
        });

        // Must be the last one or the sub-user will not be able to access
        // the machine:
        t.test('Remove machine role-tag', function (t7) {
            cli.put({
                path: '/' + ACCOUNT_NAME + '/machines/' + SUB_MACHINE_UUID,
                headers: {
                    'accept-version': '~7.2'
                }
            }, {
                'role-tag': []
            }, function (err, req, res, body) {
                t7.ifError(err);
                t7.equal(res.statusCode, 200);
                t7.ok(body['role-tag']);
                t7.ok(Array.isArray(body['role-tag']));
                t7.equal(0, body['role-tag'].length);
                cli.close();
                t7.end();
            });
        });

        t.end();
    });
});


test('Add submachine role-tag', function (t) {
    CLIENT.put({
        path: '/' + ACCOUNT_NAME + '/machines/' + SUB_MACHINE_UUID,
        headers: {
            'accept-version': '~7.2'
        }
    }, {
        'role-tag': [ROLE_NAME]
    }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(body['role-tag']);
        t.ok(Array.isArray(body['role-tag']));
        t.equal(body['role-tag'][0], ROLE_NAME);
        t.end();
    });
});


test('Verify submachine role-tag', function (t) {
    CLIENT.get({
        path: '/' + ACCOUNT_NAME + '/machines/' + SUB_MACHINE_UUID,
        headers: {
            'accept-version': '~7.2',
            'role-tag': true
        }
    }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], ROLE_NAME, 'resource role-tag');
        t.end();
    });
});


test('Add submachine role-tag - other', function (t) {
    OTHER.put({
        path: '/' + ACCOUNT_NAME + '/machines/' + SUB_MACHINE_UUID,
        headers: {
            'accept-version': '~7.2'
        }
    }, {
        'role-tag': [ROLE_NAME]
    }, function (err, req, res, body) {
        common.checkNotAuthorized(t, err, req, res, body);
        t.end();
    });
});


test('Delete tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, CLIENT, OTHER, MACHINE_UUID, function () {
        t.end();
    });
});


test('Delete sub-user machine tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, CLIENT, OTHER, SUB_MACHINE_UUID, function () {
        t.end();
    });
});


test('cleanup resources', function (t) {
    common.deleteResources(CLIENT, function (err) {
        t.ifError(err);
        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
