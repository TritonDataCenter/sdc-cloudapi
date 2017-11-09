/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Create a VM, perform a series of nic tests on it, tear VM down.
 */

var assert = require('assert-plus');
var test = require('tape').test;
var util = require('util');
var vasync = require('vasync');

var common = require('./common');
var machinesCommon = require('./machines/common');
var waitForJob = machinesCommon.waitForJob;


// --- Globals

var format = util.format;

var FABRIC_TEST_OPTS = {
    skip: !common.getCfg().fabrics_enabled
};

var SDC_128 = common.sdc_128_package;

var FIXTURE_DATA = {
    inst: {
        name: 'sdccloudapitest_nics_inst'
    },
    networks: [
        {
            nicTag: {
                name: 'sdccloudapitest_nics_nictag1'
            },
            network: {
                'name': 'sdccloudapitest_nics_network1',
                'vlan_id': 4,
                'subnet': '10.66.60.0/24',
                'netmask': '255.255.255.0',
                'provision_start_ip': '10.66.60.10',
                'provision_end_ip': '10.66.60.240'
            },
            pool: {
                name: 'sdccloudapitest_nics_pool1'
            },
            addOwner: true
        },
        {
            nicTag: {
                name: 'sdccloudapitest_nics_nictag2'
            },
            network: {
                // this network won't be added to the test machine
                'name': 'sdccloudapitest_nics_network2',
                'vlan_id': 6,
                'subnet': '10.66.62.0/24',
                'netmask': '255.255.255.0',
                'provision_start_ip': '10.66.62.10',
                'provision_end_ip': '10.66.62.240'
            },
            pool: {
                name: 'sdccloudapitest_nics_pool2'
            }
        },
        {
            /*
             * The 'internal' nic tag is only added if there is no 'internal'
             * nic_tag already in the DC. We add this for testing because
             * 'internal' is special for finding internal networks to use as a
             * default network for CreateMachine requests not otherwise
             * specifying networks.
             *
             * TODO: This sucks because we can't know to clean this up after a
             * failed test run. Alternatives would be nice. Perhaps a test mode
             * configuration of cloudapi to use a given test nic tag name.
             */
            nicTag: {
                name: 'internal'
            },
            nicTagUseExisting: true,
            network: {
                'name': 'sdccloudapitest_nics_network_internal',
                'vlan_id': 8,
                'subnet': '10.66.64.0/24',
                'netmask': '255.255.255.0',
                'provision_start_ip': '10.66.64.10',
                'provision_end_ip': '10.66.64.240'
            },
            pool: {
                name: 'sdccloudapitest_nics_pool_internal'
            }
        }
    ]
};


var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var IP_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
var MAC_RE = /^(?:[0-9a-f]{2}\:){5}[0-9a-f]{2}/i;

var CLIENTS;
var CLIENT;
var OTHER;
var CLOUDAPI_SERVER;


// --- Helpers

/*
 * Delete all test data (fixtures) for this test file.
 *
 * @param t {Object}
 * @param fixtures {Object} Passing in `fixtures` is optional. Sometimes it
 *      includes information on whether the 'internal' nic tag was created
 *      and can be deleted.
 * @param cb {Function}
 */
function deleteFixtures(t, fixtures, cb) {
    assert.optionalObject(fixtures, 'fixtures');

    vasync.pipeline({arg: {}, funcs: [
        /*
         * We use VMAPI to clean up the test inst because the cloudapi
         * tests are creating new users for every test run.
         */
        function getTestInstId(ctx, next) {
            if (fixtures && fixtures.instId) {
                ctx.instId = fixtures.instId;
                next();
            } else {
                CLIENT.vmapi.listVms({
                    state: 'active',
                    alias: FIXTURE_DATA.inst.name
                }, function (err, vms) {
                    t.ifError(err, 'listVms for vm ' + FIXTURE_DATA.inst.name);
                    if (err) {
                        next(err);
                    } else if (vms.length === 0) {
                        next();
                    } else {
                        ctx.instId = vms[0].uuid;
                        t.equal(vms.length, 1, 'found a match: ' + ctx.instId);
                        next();
                    }
                });
            }
        },
        function deleteTestInst(ctx, next) {
            if (!ctx.instId) {
                next();
                return;
            }
            CLIENT.vmapi.deleteVm({uuid: ctx.instId}, function (err, job) {
                t.ifError(err, 'deleteTestInst ' + ctx.instId);
                if (job) {
                    ctx.deleteJobUuid = job.job_uuid;
                    t.ok(ctx.deleteJobUuid,
                        'delete job uuid: ' + ctx.deleteJobUuid);
                }
                next(err);
            });
        },
        function waitTilMachineDeleted(ctx, next) {
            if (!ctx.deleteJobUuid) {
                next();
                return;
            }
            waitForJob(CLIENT, ctx.deleteJobUuid, function (err) {
                t.ifError(err, 'waitForJob ' + ctx.deleteJobUuid);
                next(err);
            });
        },

        function getATestServer(ctx, next) {
            if (fixtures) {
                ctx.server = fixtures.server;
                next();
                return;
            }
            common.getTestServer(CLIENT, function (err, testServer) {
                t.ifError(err, 'getATestServer');
                ctx.server = testServer;
                next();
            });
        },

        function removeServerTags(ctx, next) {
            var nicTags = [FIXTURE_DATA.networks[0].nicTag.name];

            /*
             * If we added an 'internal' NIC tag to the server in this test
             * run, then remove it now.
             */
            if (fixtures && fixtures.internal &&
                !fixtures.internal.existingNicTag)
            {
                nicTags.push(fixtures.internal.nicTag.name);
            }

            removeTagsFromServer(t, nicTags, ctx.server, function (err, job) {
                t.ifError(err, 'remove NIC tags from server: '
                    + nicTags);

                waitForJob(CLIENT, job.job_uuid, function (err2) {
                    t.ifError(err2, 'waitForJob ' + job.job_uuid);
                    next(err2);
                });
            });
        },

        function deleteTestNetworks(_, next) {
            var i = 0;
            vasync.forEachPipeline({
                inputs: FIXTURE_DATA.networks,
                func: function deleteOneTestNetwork(data, nextOne) {
                    var fixture = (fixtures ? fixtures.networks[i] : null);
                    i++;
                    deleteTestNetwork(t, data, fixture, function (err) {
                        t.ifError(err, 'deleteTestNetwork completed');
                        nextOne(err);
                    });
                }
            }, next);
        }
    ]}, function (err) {
        t.ifError(err, 'deleteFixtures complete');
        cb();
    });
}


/*
 * Create fixtures and pass them back.
 *
 * @param t
 * @param cb {Function} `function (err, fixtures)`
 */
function createFixtures(t, cb) {
    var fixtures = {
        networks: []
    };

    vasync.pipeline({arg: {}, funcs: [
        function addTestNetworks(_, next) {
            vasync.forEachPipeline({
                inputs: FIXTURE_DATA.networks,
                func: function createOneTestNetwork(data, nextOne) {
                    createTestNetwork(t, data, function (err, fixture) {
                        t.ifError(err, 'createTestNetwork');
                        if (err) {
                            nextOne(err);
                            return;
                        }
                        t.ok(fixture, 'fixture');
                        fixtures.networks.push(fixture);
                        if (data.nicTag.name === 'internal') {
                            fixtures.internal = fixture;
                        }
                        nextOne();
                    });
                }
            }, next);
        },

        function getExternalNetwork(_, next) {
            CLIENT.napi.listNetworks({
                nic_tag: 'external'
            }, function (err, nets) {
                t.ifError(err, 'getExternalNetwork');
                t.equal(nets.length, 1,
                    'there is one nic_tag=external network');
                fixtures.externalNetwork = nets[0];
                // XXX Boy this sure makes some assumptions. :| Fix that.
                fixtures.externalNetRe = new RegExp(
                    '^' + nets[0].subnet.split('.').slice(0, 2).join('.'));
                next();
            });
        },

        function getATestServer(_, next) {
            common.getTestServer(CLIENT, function (err, testServer) {
                t.ifError(err, 'getTestServer');
                fixtures.server = testServer;
                next();
            });
        },

        function addServerTags(_, next) {
            var nicTags = [fixtures.networks[0].nicTag.name];

            /*
             * If we created an 'internal' network above, we'll need to add
             * that NIC tag to the server to which we will provision.
             */
            if (fixtures.internal) {
                nicTags.push(fixtures.internal.nicTag.name);
            }

            addNicTagsToServer(t, nicTags, fixtures.server,
                    function (err, job) {
                t.ifError(err);
                waitForJob(CLIENT, job.job_uuid, function (err2) {
                    t.ifError(err2);
                    next();
                });
            });
        },

        function createTestInst(_, next) {
            common.getTestImage(CLIENT, function (err, image) {
                t.ifError(err, 'getTestImage');
                if (err) {
                    next(err);
                    return;
                }

                var obj = {
                    image: image.id,
                    package: SDC_128.name,
                    name: FIXTURE_DATA.inst.name,
                    server_uuid: fixtures.server.uuid,
                    firewall_enabled: true
                };
                machinesCommon.createMachine(t, CLIENT, obj,
                        function (err2, instId) {
                    t.ifError(err2, 'createTestInst');
                    fixtures.instId = instId;
                    next(err2);
                });
            });
        },

        function waitForTestInst(_, next) {
            machinesCommon.waitForRunningMachine(CLIENT, fixtures.instId,
                    function (err) {
                t.ifError(err, 'waitForRunningMachine ' + fixtures.instId);
                next(err);
            });
        },

        /*
         * `fixtures.otherVm` is a machine owned by someone else.
         * We use one owned by 'admin' for this.
         *
         * TODO: Eventually we shouldn't use admin VMs. Test suites shouldn't
         * touch them.
         */
        function getOtherVm(_, next) {
            CLIENT.ufds.getUser('admin', function (err, admin) {
                t.ifError(err, 'ufds.getUser("admin")');
                t.ok(admin, 'admin account');

                CLIENT.vmapi.listVms({
                    owner_uuid: admin.uuid,
                    state: 'active',
                    limit: 1
                }, function (err2, vms) {
                    t.ifError(err2, 'list admin VMs');
                    if (vms) {
                        t.ok(vms[0], 'found an admin VM to be "otherMachine"');
                        fixtures.otherVm = vms[0];
                    }
                    next(err2);
                });
            });

        },

        /*
         * 'fixtures.otherNetwork' is a network owned by someone other than
         * the test users. For now we are using the 'admin' network.
         *
         * TODO: Don't use the admin network. Test suites shouldn't touch it.
         */
        function getOtherNetwork(_, next) {
            CLIENT.napi.listNetworks({ name: 'admin' },
                    function (err, networks) {
                t.ifError(err, 'list admin networks');
                t.ok(Array.isArray(networks), 'got an array of networks');
                t.equal(networks.length, 1, 'there is *one* "admin" network');
                fixtures.otherNetwork = networks[0];
                t.ok(fixtures.otherNetwork.owner_uuids &&
                    fixtures.otherNetwork.owner_uuids.length > 0,
                    'the admin network has owners');
                next();
            });
        }
    ]}, function (err) {
        t.ifError(err, 'createFixtures');
        cb(err, fixtures);
    });
}



/*
 * Create a test nic tag, network and network pool per the given `data`.
 */
function createTestNetwork(t, data, cb) {
    var fixture = {};

    vasync.pipeline({funcs: [
        function haveNicTag(_, next) {
            CLIENT.napi.getNicTag(data.nicTag.name, function (err, nicTag) {
                if (!err) {
                    fixture.existingNicTag = nicTag;
                    next();
                } else if (err.statusCode === 404) {
                    next();
                } else {
                    next(err);
                }
            });
        },

        function mkTestNicTag(_, next) {
            if (fixture.existingNicTag) {
                if (data.nicTagUseExisting) {
                    fixture.nicTag = fixture.existingNicTag;
                    next();
                } else {
                    next(new Error('nic tag ' + data.nicTag.name
                        + ' already exists'));
                }
            } else {
                CLIENT.napi.createNicTag(data.nicTag.name,
                        function (err, nicTag) {
                    t.ifError(err,
                        'createTestNetwork: nicTag ' + data.nicTag.name);
                    if (err) {
                        next(err);
                        return;
                    }
                    fixture.nicTag = nicTag;
                    next();
                });
            }
        },

        function mkTestNetwork(_, next) {
            data.network.nic_tag = fixture.nicTag.name;
            if (data.addOwner) {
                data.network.owner_uuids = [CLIENT.account.uuid];
            }
            CLIENT.napi.createNetwork(data.network, function (err, net) {
                t.ifError(err,
                    'createTestNetwork: network ' + data.network.name);
                if (err) {
                    next(err);
                    return;
                }
                fixture.network = net;
                next();
            });
        },

        function mkTestNetworkPool(_, next) {
            data.pool.nic_tag = fixture.nicTag.name;
            data.pool.networks = [fixture.network.uuid];
            if (data.addOwner) {
                data.pool.owner_uuids = [CLIENT.account.uuid];
            }
            CLIENT.napi.createNetworkPool(data.pool.name, data.pool,
                    function (err, pool) {
                t.ifError(err, 'createTestNetwork: pool ' + data.pool.name);
                if (err) {
                    next(err);
                    return;
                }
                fixture.pool = pool;
                next();
            });
        }

    ]}, function (err) {
        cb(err, fixture);
    });
}


/*
 * Delete a test network/pool/nic_tag defined by `data` (one of the elements
 * from `FIXTURE_DATA`. It is not an error if the named object doesn't exist.
 *
 * `fixture` is optional. If defined, it is the objects for the created
 * elements during this test run. This can be useful for determining if
 * some objects *should* be deleted, if they existed already before the test
 * run. Specifically if `data.nicTagUseExisting` is true, then we can only
 * delete it *if we know we created it during this test run* -- that means
 * `fixture` is provided, but `fixture.existingNicTag` isn't set.
 */
function deleteTestNetwork(t, data, fixture, cb) {
    vasync.pipeline({funcs: [
        function deletePool(_, next) {
            common.napiDeletePoolByName({
                napi: CLIENT.napi,
                name: data.pool.name
            }, function (err) {
                t.ifError(err, 'deletePool ' + data.pool.name);
                next();
            });
        },
        function deleteNetwork(_, next) {
            common.napiDeleteNetworkByName({
                napi: CLIENT.napi,
                name: data.network.name
            }, function (err) {
                t.ifError(err, 'deleteNetwork ' + data.network.name);
                next();
            });
        },
        function deleteNicTag(_, next) {
            if (!data.nicTagUseExisting ||
                (fixture && !fixture.existingNicTag))
            {
                common.napiDeleteNicTagByName({
                    napi: CLIENT.napi,
                    name: data.nicTag.name
                }, function (err) {
                    t.ifError(err, 'deleteNicTag ' + data.nicTag.name);
                    next(err);
                });
            } else {
                // Don't delete a pre-existing nic tag.
                next();
            }
        }
    ]}, cb);
}


function externalNicMacFromServer(server) {
    var ifaces = server.sysinfo['Network Interfaces'];
    var nic = Object.keys(ifaces).map(function (iname) {
        return ifaces[iname];
    }).filter(function (iface) {
        return iface['NIC Names'].indexOf('external') !== -1;
    })[0];
    return nic['MAC Address'];
}


/*
 * Add the given NIC tags to the server's external NIC.
 *
 * Calls back with `function (err, job)` where `job` is the the CNAPI
 * NicUpdate response body (i.e. `job.job_uuid` is the workflow job UUID).
 */
function addNicTagsToServer(t, nicTags, server, callback) {
    var args = {
        action: 'update',
        nics: [ {
            mac: externalNicMacFromServer(server),
            nic_tags_provided: nicTags
        } ]
    };
    CLIENT.cnapi.updateNics(server.uuid, args, function (err, body, res) {
        t.ifError(err);
        callback(null, body);
    });
}


function removeTagsFromServer(t, nicTags, server, callback) {
    var args = {
        action: 'delete',
        nics: [ {
            mac: externalNicMacFromServer(server),
            nic_tags_provided: nicTags
        } ]
    };
    CLIENT.cnapi.updateNics(server.uuid, args, function (err, body, res) {
        t.ifError(err);
        callback(null, body);
    });
}


function getErr(t, path, expectedErr) {
    CLIENT.get(path, function (err, req, res, body) {
        t.equal(res.statusCode, expectedErr.statusCode);
        t.deepEqual(err, expectedErr);
        t.deepEqual(body, expectedErr.body);

        t.end();
    });
}


function postErr(t, path, args, expectedErr) {
    verifyUnchangedNics(t, function (next) {
        CLIENT.post(path, args, function (err, req, res, body) {
            t.equal(res.statusCode, expectedErr.statusCode);
            t.deepEqual(err, expectedErr);
            t.deepEqual(body, expectedErr.body);

            next();
        });
    });
}


function checkDelFails(t, path, expectedErr) {
    verifyUnchangedNics(t, function (next) {
        CLIENT.del(path, function (err, req, res, body) {
            t.deepEqual(err, expectedErr, 'DELETE ' + path);
            t.equal(res.statusCode, expectedErr.statusCode, 'DELETE ' + path
                + ' ' + expectedErr.statusCode + ' statusCode');
            t.deepEqual(body, expectedErr.body, 'DELETE ' + path + ' body');

            next();
        });
    });
}


function verifyUnchangedNics(t, mutator) {
    CLIENT.napi.listNics({
        belongs_to_type: 'zone'
    }, function (err, origNics) {
        t.ifError(err, 'NAPI ListNics for origNics');
        t.ok(origNics.length > 0, 'have >0 origNics');

        mutator(function () {
            // check nics didn't change
            CLIENT.napi.listNics({
                belongs_to_type: 'zone'
            }, function (err2, newNics) {
                t.ifError(err2, 'NAPI ListNics for newNics');

                /*
                 * Ignore some useless fields:
                 * - The 'state' property of NICs isn't currently useful for
                 *   anything. When a NIC is created in NAPI it is typically
                 *   set to state=provisioning. After that, net-agent will
                 *   asynchronously set it to 'running' or 'stopped' depending
                 *   on the VM state. There is also a reference to updating
                 *   nic.state in sdc-vmapi.git -- but that looks like unused
                 *   code.
                 * - The 'modified_timestamp' is updated asynchronously which
                 *   can break these tests. I'm not sure why that is updated.
                 *   Perhaps a no-op UpdateNic from net-agent.
                 *
                 * Because those changes are asynchronous, it is difficult and
                 * obtuse to wait for nic state settling for testing. Therefore
                 * we will just skip comparison of those fields.
                 */
                var dropAsyncUpdatedNicProps = function (nic) {
                    delete nic.modified_timestamp;
                    delete nic.state;
                };
                origNics.forEach(dropAsyncUpdatedNicProps);
                newNics.forEach(dropAsyncUpdatedNicProps);

                var changes = findObjectArrayChanges(origNics, newNics, 'mac');
                t.equal(changes.length, 0,
                    'origNics and newNics should be the same: differing NICs: '
                        + JSON.stringify(changes));

                t.end();
            });
        });
    });
}


/*
 * Return an array of "change" objects:
 *      {"original": <object from oldArr>, "modified": <object from newArr>}
 * for each differing object (identified by the `key` field).
 *
 * Limitation: This assumes keys on the objects being compared are in the same
 * order. This suffices for NIC objects from NAPI.
 */
function findObjectArrayChanges(oldArr, newArr, key) {
    var oldArrLookup = {};
    oldArr.forEach(function (oldObj) {
        var val = oldObj[key];
        oldArrLookup[val] = oldObj;
    });

    var changes = [];

    newArr.forEach(function (newObj) {
        var val = newObj[key];
        var oldObj = oldArrLookup[val];

        if (!oldObj || JSON.stringify(newObj) !== JSON.stringify(oldObj)) {
            changes.push({ original: oldObj, modified: newObj });
        }

        delete oldArrLookup[val];
    });

    Object.keys(oldArrLookup).forEach(function (name) {
        changes.push({ original: oldArrLookup[name], modified: null});
    });

    return changes;
}


function waitTilNicAdded(t, path) {
    var count = 30;

    function check() {
        count--;
        if (count === 0) {
            t.ifError(true, 'NIC did not provision in time');
            return t.end();
        }

        return CLIENT.get(path, function (err, req, res, nic) {
            t.ifError(err);

            if (nic.state === 'running') {
                return t.end();
            } else {
                return setTimeout(check, 5000);
            }
        });
    }

    check();
}


/*
 * Remove the given instance NIC and wait for its deletion.
 */
function removeNic(t, instId, nic) {
    var mac  = nic.mac.replace(/\:/g, '');
    var path = '/my/machines/' + instId + '/nics/' + mac;

    CLIENT.del(path, function (err, req, res, body) {
        t.ifError(err, 'RemoveNic with mac ' + mac + ' from vm ' + instId);
        t.equal(res.statusCode, 204, 'RemoveNic 204 statusCode');
        t.deepEqual(body, {}, 'RemoveNic "{}" body');

        waitTilNicDeleted(t, path);
    });
}


function waitTilNicDeleted(t, apiPath) {
    // Sometimes NICs take a very long time to delete due to long-reboot
    // times that some zones experience
    var count = 120;

    function check() {
        count--;
        if (count === 0) {
            t.ifError(true, 'NIC did not delete in time');
            t.end();
            return;
        }

        CLIENT.get(apiPath, function (err, req, res, nic) {
            if (err) {
                t.equal(err.statusCode, 404);
                t.end();
            } else {
                setTimeout(check, 5000);
            }
        });
    }

    check();
}


// --- Tests

test('nics', function (tt) {
    var fixtures;
    var instNic;

    tt.test('  setup', function (t) {
        vasync.pipeline({funcs: [
            function commonSetup(_, next) {
                common.setup(function (err, clients, server) {
                    t.ifError(err, 'commonSetup err');
                    t.ok(clients, 'commonSetup clients');
                    CLIENTS = clients;
                    CLIENT  = clients.user;
                    OTHER   = clients.other;
                    CLOUDAPI_SERVER = server;
                    next();
                });
            },
            function cleanStart(_, next) {
                deleteFixtures(t, null, next);
            },
            function setupFixtures(_, next) {
                createFixtures(t, function (err, fixtures_) {
                    if (err) {
                        next(err);
                        return;
                    }
                    fixtures = fixtures_;
                    t.ok(fixtures, 'fixtures');
                    next();
                });
            }
        ]}, function (err) {
            t.ifError(err, 'setup');
            t.end();
        });
    });

    // this also checks that a VM creates with an external and internal nic by
    // default if the package doesn't list networks
    tt.test('  List NICs', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics';

        CLIENT.get(path, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);

            var nics = body;

            t.ok(Array.isArray(nics));
            t.equal(nics.length, 2);

            var externalNic;
            var internalNic;

            if (nics[0].ip.match(fixtures.externalNetRe)) {
                externalNic = nics[0];
                internalNic = nics[1];
            } else if (nics[1].ip.match(fixtures.externalNetRe)) {
                externalNic = nics[1];
                internalNic = nics[0];
            } else {
                t.ok(false, 'problem with created nics');
            }

            t.ok(externalNic.mac.match(MAC_RE));
            t.ok(externalNic.netmask.match(IP_RE));
            t.ok(externalNic.gateway.match(IP_RE));
            t.equal(externalNic.primary, true);

            t.ok(internalNic.ip.match(/^10.66.64/));
            t.ok(internalNic.mac.match(MAC_RE));
            t.ok(internalNic.netmask.match(IP_RE));
            t.equal(internalNic.primary, false);

            nics.forEach(function (nic) {
                t.ifError(nic.resolvers);
                t.ifError(nic.owner_uuid);
                t.ifError(nic.network_uuid);
                t.ifError(nic.nic_tag);
                t.ifError(nic.belongs_to_type);
                t.ifError(nic.belongs_to_uuid);
                t.ifError(nic.belongs_to_type);
                t.ifError(nic.belongs_to_uuid);
            });

            instNic = externalNic;

            t.end();
        });
    });


    tt.test('  Head NICs', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics';

        CLIENT.head(path, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            t.deepEqual(body, {});
            t.end();
        });
    });


    tt.test('  Head NICs - other', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics';

        OTHER.head(path, function (err, req, res, body) {
            t.ok(err);
            t.equal(res.statusCode, 404);
            t.end();
        });
    });


    tt.test('  List NICs on other machine', function (t) {
        var path = '/my/machines/' + fixtures.otherVm.uuid + '/nics';

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'VM not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'VM not found'
            }
        };

        getErr(t, path, expectedErr);
    });


    tt.test('  List NICs on nonexistent machine', function (t) {
        var path = '/my/machines/fdc3cefd-1943-4050-ba59-af5680508481/nics';

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'VM not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'VM not found'
            }
        };

        getErr(t, path, expectedErr);
    });


    tt.test('  List NICs on invalid machine', function (t) {
        var path = '/my/machines/wowzers/nics';

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'Invalid Parameters',
            statusCode: 409,
            restCode: 'ValidationFailed',
            name: 'ValidationFailedError',
            body: {
                code: 'ValidationFailed',
                message: 'Invalid Parameters',
                errors: [ {
                    field: 'uuid',
                    code: 'Invalid',
                    message: 'Invalid UUID'
                } ]
            }
        };

        getErr(t, path, expectedErr);
    });


    tt.test('  Get NIC', function (t) {
        var mac = instNic.mac.replace(/\:/g, '');
        var path = '/my/machines/' + fixtures.instId + '/nics/' + mac;

        CLIENT.get(path, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);

            t.deepEqual(instNic, body);

            t.end();
        });
    });


    tt.test('  Head NIC', function (t) {
        var mac = instNic.mac.replace(/\:/g, '');
        var path = '/my/machines/' + fixtures.instId + '/nics/' + mac;

        CLIENT.head(path, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            t.deepEqual(body, {});
            t.end();
        });
    });


    tt.test('  Head NIC - other', function (t) {
        var mac = instNic.mac.replace(/\:/g, '');
        var path = '/my/machines/' + fixtures.instId + '/nics/' + mac;

        OTHER.head(path, function (err, req, res, body) {
            t.ok(err);
            t.equal(res.statusCode, 404);
            t.end();
        });
    });


    tt.test('  Get nonexistent NIC', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics/baadd34db33f';

        // the err message must match the 'Get non-owner NIC from owner machine'
        // test below
        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'nic not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        };

        getErr(t, path, expectedErr);
    });


    tt.test('  Get invalid NIC', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics/wowzers';

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'mac has invalid format',
            statusCode: 409,
            restCode: 'InvalidArgument',
            name: 'InvalidArgumentError',
            body: {
                code: 'InvalidArgument',
                message: 'mac has invalid format'
            }
        };

        getErr(t, path, expectedErr);
    });


    tt.test('  Get NIC from invalid machine', function (t) {
        var mac = instNic.mac.replace(/\:/g, '');
        var path = '/my/machines/wowzers/nics/' + mac;

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'Invalid Parameters',
            statusCode: 409,
            restCode: 'ValidationFailed',
            name: 'ValidationFailedError',
            body: {
                code: 'ValidationFailed',
                message: 'Invalid Parameters',
                errors: [ {
                    field: 'uuid',
                    code: 'Invalid',
                    message: 'Invalid UUID'
                } ]
            }
        };

        getErr(t, path, expectedErr);
    });


    tt.test('  Get owner NIC from non-owner machine', function (t) {
        var mac = instNic.mac.replace(/\:/g, '');
        var path = '/my/machines/' + fixtures.otherVm.uuid + '/nics/' + mac;

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'VM not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'VM not found'
            }
        };

        getErr(t, path, expectedErr);
    });


    tt.test('  Get non-owner NIC from owner machine', function (t) {
        var mac = fixtures.otherVm.nics[0].mac.replace(/\:/g, '');
        var path = '/my/machines/' + fixtures.instId + '/nics/' + mac;

        // the err message must match the 'Get nonexistent NIC' test above
        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'nic not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        };

        getErr(t, path, expectedErr);
    });


    tt.test('  Get non-owner NIC from non-owner machine', function (t) {
        var mac = fixtures.otherVm.nics[0].mac.replace(/\:/g, '');
        var path = '/my/machines/' + fixtures.otherVm.uuid + '/nics/' + mac;

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'VM not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'VM not found'
            }
        };

        getErr(t, path, expectedErr);
    });


    tt.test('  Get NIC from nonexistent machine', function (t) {
        var path = '/my/machines/fa9e18e4-654a-43a8-918b-cce04bdbf461/nics/'
            + instNic.mac.replace(/\:/g, '');
        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'VM not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'VM not found'
            }
        };

        getErr(t, path, expectedErr);
    });


    tt.test('  Create NIC using network', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics';
        var args = { network: fixtures.networks[0].network.uuid };

        CLIENT.post(path, args, function (err, req, res, nic) {
            t.ifError(err, 'POST ' + path);
            t.equal(res.statusCode, 201, 'CreateNic 201 statusCode');

            t.ok(nic, format('nic: %j', nic));
            t.ok(nic.mac.match(MAC_RE), format('nic.mac, %j, matches %s',
                nic.mac, MAC_RE));
            t.ok(nic.ip.match(IP_RE), format('nic.ip, %j, matches %s',
                nic.ip, IP_RE));
            t.equal(nic.primary, false, 'nic is not primary');
            t.equal(nic.state, 'provisioning',
                'nic.state === "provisioning":' + nic.state);

            var nicFront = nic.ip.split('.').slice(0, 3).join('.');
            var netFront = fixtures.networks[0].network.subnet
                .split('.').slice(0, 3).join('.');
            t.equal(nicFront, netFront,
                format('NIC IP prefix, %j, matches network subnet prefix, %j',
                    nicFront, netFront));

            // PUBAPI-1229: added nic.network field in cloudapi v8.0.1
            t.equal(nic.network, fixtures.networks[0].network.uuid,
                'nic.network: ' + nic.network);

            // Should explicitly only have these fields:
            var requiredFromNicField = {
                mac: true,
                ip: true,
                primary: true,
                netmask: true,
                state: true,
                network: true,
                gateway: false
            };
            var nicCopy = common.objCopy(nic);
            Object.keys(requiredFromNicField).forEach(function (field) {
                var required = requiredFromNicField[field];
                if (required && !nicCopy.hasOwnProperty(field)) {
                    t.fail('nic is missing field: ' + field);
                }
                delete nicCopy[field];
            });
            t.equal(Object.keys(nicCopy).length, 0,
                format('unexpected extra fields on nic: %j', nicCopy));

            var location = res.headers.location;
            t.ok(location);

            CLIENT.get(location, function (err2, req2, res2, nic2) {
                t.ifError(err2);
                t.equal(res2.statusCode, 200);

                t.deepEqual(nic, nic2);
                instNic = nic;

                waitTilNicAdded(t, location);
            });
        });
    });


    tt.test('  Create non-owner network on owner machine', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics';
        var args = { network: fixtures.otherNetwork.uuid };

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'owner cannot provision on network',
            statusCode: 403,
            restCode: 'NotAuthorized',
            name: 'NotAuthorizedError',
            body: {
                code: 'NotAuthorized',
                message: 'owner cannot provision on network'
            }
        };

        postErr(t, path, args, expectedErr);
    });


    tt.test('  Create owner network on non-owner machine', function (t) {
        var path = '/my/machines/' + fixtures.otherVm.uuid + '/nics';
        var args = { network: fixtures.networks[0].network.uuid };

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'VM not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'VM not found'
            }
        };

        postErr(t, path, args, expectedErr);
    });


    tt.test('  Create non-owner network on non-owner machine', function (t) {
        var path = '/my/machines/' + fixtures.otherVm.uuid + '/nics';
        var args = { network: fixtures.otherNetwork.uuid };

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'VM not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'VM not found'
            }
        };

        postErr(t, path, args, expectedErr);
    });


    tt.test('  Create NIC on server missing nic tag', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics';
        // NB: 1, not 0
        var args = { network: fixtures.networks[1].network.uuid };

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'Server does not support that network',
            statusCode: 409,
            restCode: 'InvalidArgument',
            name: 'InvalidArgumentError',
            body: {
                code: 'InvalidArgument',
                message: 'Server does not support that network'
            }
        };

        postErr(t, path, args, expectedErr);
    });


    tt.test('  Create NIC with pool on server missing nic tag', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics';
        var args = { network: fixtures.networks[1].pool.uuid };

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'Server does not support that network',
            statusCode: 409,
            restCode: 'InvalidArgument',
            name: 'InvalidArgumentError',
            body: {
                code: 'InvalidArgument',
                message: 'Server does not support that network'
            }
        };

        postErr(t, path, args, expectedErr);
    });


    tt.test('  Create with invalid network', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics';
        var args = { network: 'wowzers' };

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'network argument has invalid format',
            statusCode: 409,
            restCode: 'InvalidArgument',
            name: 'InvalidArgumentError',
            body: {
                code: 'InvalidArgument',
                message: 'network argument has invalid format'
            }
        };

        postErr(t, path, args, expectedErr);
    });


    tt.test('  Create with invalid machine', function (t) {
        var path = '/my/machines/wowzers/nics';
        var args = { network: fixtures.networks[0].network.uuid };

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'Invalid Parameters',
            statusCode: 409,
            restCode: 'ValidationFailed',
            name: 'ValidationFailedError',
            body: {
                code: 'ValidationFailed',
                message: 'Invalid Parameters',
                errors: [ {
                    field: 'uuid',
                    code: 'Invalid',
                    message: 'Invalid UUID'
                } ]
            }
        };

        postErr(t, path, args, expectedErr);
    });


    tt.test('  Create with nonexistent network', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics';
        var args = { network: '05cab1d4-f816-41c0-b45f-a4ffeda5a6b5' };

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'network not found',
            statusCode: 409,
            restCode: 'InvalidArgument',
            name: 'InvalidArgumentError',
            body: {
                code: 'InvalidArgument',
                message: 'network not found'
            }
        };

        postErr(t, path, args, expectedErr);
    });


    tt.test('  Create with nonexistent machine', function (t) {
        var path = '/my/machines/aa26a3ee-e3d4-4e7e-a087-678ca877a338/nics';
        var args = { network: fixtures.networks[0].network.uuid };

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'VM not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'VM not found'
            }
        };

        postErr(t, path, args, expectedErr);
    });


    tt.test('  Remove owner NIC from non-owner machine', function (t) {
        var mac  = instNic.mac.replace(/\:/g, '');
        var path = '/my/machines/' + fixtures.otherVm.uuid + '/nics/' + mac;

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'VM not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'VM not found'
            }
        };

        checkDelFails(t, path, expectedErr);
    });


    tt.test('  Remove non-owner NIC from owner machine', function (t) {
        var mac  = fixtures.otherVm.nics[0].mac.replace(/\:/g, '');
        var path = '/my/machines/' + fixtures.instId + '/nics/' + mac;

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'nic not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        };

        checkDelFails(t, path, expectedErr);
    });


    tt.test('  Remove non-owner NIC from non-owner machine', function (t) {
        var mac  = fixtures.otherVm.nics[0].mac.replace(/\:/g, '');
        var path = '/my/machines/' + fixtures.otherVm.uuid + '/nics/' + mac;

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'VM not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'VM not found'
            }
        };

        checkDelFails(t, path, expectedErr);
    });


    tt.test('  Remove invalid NIC', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics/wowzers';

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'mac has invalid format',
            statusCode: 409,
            restCode: 'InvalidArgument',
            name: 'InvalidArgumentError',
            body: {
                code: 'InvalidArgument',
                message: 'mac has invalid format'
            }
        };

        checkDelFails(t, path, expectedErr);
    });


    tt.test('  Remove NIC from invalid machine', function (t) {
        var mac  = instNic.mac.replace(/\:/g, '');
        var path = '/my/machines/wowzers/nics/' + mac;

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'Invalid Parameters',
            statusCode: 409,
            restCode: 'ValidationFailed',
            name: 'ValidationFailedError',
            body: {
                code: 'ValidationFailed',
                message: 'Invalid Parameters',
                errors: [ {
                    field: 'uuid',
                    code: 'Invalid',
                    message: 'Invalid UUID'
                } ]
            }
        };

        checkDelFails(t, path, expectedErr);
    });


    tt.test('  Remove nonexistent NIC', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics/012345678901';

        var expectedErr = {
            jse_info: {},
            jse_shortmsg: '',
            message: 'nic not found',
            statusCode: 404,
            restCode: 'ResourceNotFound',
            name: 'ResourceNotFoundError',
            body: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        };

        checkDelFails(t, path, expectedErr);
    });


    tt.test('  Remove NIC using network', function (t) {
        removeNic(t, fixtures.instId, instNic);
    });


    tt.test('  Create NIC using network pool', function (t) {
        var path = '/my/machines/' + fixtures.instId + '/nics';
        var args = { network: fixtures.networks[0].pool.uuid };

        CLIENT.post(path, args, function (err, req, res, nic) {
            t.ifError(err);
            t.equal(res.statusCode, 201);

            t.ok(nic.mac.match(MAC_RE));
            t.ok(nic.ip.match(IP_RE));
            t.equal(nic.primary, false);
            t.equal(nic.state, 'provisioning');

            t.ifError(nic.gateway);
            t.ifError(nic.resolvers);
            t.ifError(nic.owner_uuid);
            t.ifError(nic.network_uuid);
            t.ifError(nic.nic_tag);
            t.ifError(nic.belongs_to_type);
            t.ifError(nic.belongs_to_uuid);

            var location = res.headers.location;
            t.ok(location);

            CLIENT.get(location, function (err2, req2, res2, nic2) {
                t.ifError(err2);
                t.equal(res2.statusCode, 200);

                t.deepEqual(nic, nic2);
                instNic = nic;

                waitTilNicAdded(t, location);
            });
        });
    });


    tt.test('  Remove NIC using network pool', function (t) {
        removeNic(t, fixtures.instId, instNic);
    });


    tt.test('  Add fabric network NIC', FABRIC_TEST_OPTS, function (t) {
        CLIENT.get('/my/networks', function (err, req, res, networks) {
            t.ifError(err);

            var fabricNetwork = networks.filter(function (net) {
                return net.fabric;
            })[0];
            t.ok(fabricNetwork, format('fabricNetwork %s (%s)',
                fabricNetwork.id, fabricNetwork.name));

            var path = '/my/machines/' + fixtures.instId + '/nics';
            var args = { network: fabricNetwork.id };
            CLIENT.post(path, args, function (err2, req2, res2, nic) {
                t.ifError(err2, 'AddNic to vm '+ fixtures.instId);
                t.equal(res2.statusCode, 201, 'AddNic 201 statusCode');

                var location = res2.headers.location;
                t.ok(location, 'AddNic Location header: ' + location);
                instNic = nic;
                t.ok(instNic, 'AddNic nic: ' + JSON.stringify(nic));

                waitTilNicAdded(t, location);
            });
        });
    });


    tt.test('  Remove NIC using fabric network', FABRIC_TEST_OPTS,
            function (t) {
        removeNic(t, fixtures.instId, instNic);
    });


    tt.test('  teardown', function (t) {
        deleteFixtures(t, fixtures, function (err) {
            t.ifError(err, 'deleteFixtures');

            common.teardown(CLIENTS, CLOUDAPI_SERVER, function (err2) {
                t.ifError(err2, 'teardown success');
                t.end();
            });
        });
    });
});
