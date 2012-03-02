// Copyright 2011 Joyent, Inc.  All rights reserved.

var restify = require('restify');
var uuid = require('node-uuid');

var MAPI = require('../lib/index').MAPI;



///--- Globals

var MAPI_URL = 'http://' + (process.env.MAPI_IP || '10.99.99.8') + ':8080';

var mapi = null;
var DATASET_UUID = null;
var CUSTOMER = '930896af-bf8c-48d4-885c-6573a94b1853';
var ZONE_ALIAS = process.env.MAPI_ZONE_ALIAS || 'mapi';

var ZONE = null;



///--- Helpers

function waitForState(state, callback) {
  function check() {
    return mapi.getMachine(CUSTOMER, ZONE, function(err, machine) {
      return callback(err);

      if (machine.running_status === state)
        return callback(null)

      setTimeout(check, 1000);
    });
  }

  return check();
}

///--- Tests

exports.setUp = function(test, assert) {
  mapi = new MAPI({
    url: MAPI_URL,
    username: 'admin',
    password: 'tot@ls3crit',
    retry: {
      retries: 1,
      minTimeout: 1000
    }
  });
  test.finish();
};


exports.test_list_datasets = function(test, assert) {
  mapi.listDatasets(CUSTOMER, function(err, datasets) {
    assert.ifError(err);
    assert.ok(datasets);
    assert.ok(datasets.length);
    for (var i = 0; i < datasets.length; i++) {
      if (datasets[i].name === 'smartos')
        DATASET_UUID = datasets[i].uuid;
    }
    test.finish();
  });
};


/// Start stuff to do early because of MAPI timing woes
exports.test_create_zone = function(test, assert) {
  var opts = {
    dataset_uuid: DATASET_UUID,
    networks: 'external',
    alias: uuid(),
    hostname: 'a' + uuid().substr(0, 6),
    'package': 'regular_128'
  };

  mapi.createMachine(CUSTOMER, opts, function(err, machine) {
    assert.ifError(err);
    assert.ok(machine);
    assert.equal(opts.alias, machine.alias);
    ZONE = machine.name;
    test.finish();
  });
};


exports.test_wait_for_running = function(test, assert) {
  waitForState('running', function(err) {
    assert.ifError(err);
    test.finish();
  });
};
/// End stuff to do early

exports.test_get_dataset = function(test, assert) {
  mapi.listDatasets(CUSTOMER, function(err, datasets) {
    assert.ifError(err);
    assert.ok(datasets.length);
    mapi.getDataset(CUSTOMER, datasets[0].uuid, function(err, dataset) {
      assert.ifError(err);
      assert.ok(dataset);
      test.finish();
    });
  });
};


exports.test_get_dataset_not_found = function(test, assert) {
  mapi.getDataset(CUSTOMER, uuid(), function(err, dataset) {
    assert.ok(err);
    assert.ok(!dataset);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_list_packages = function(test, assert) {
  mapi.listPackages(CUSTOMER, function(err, packages) {
    assert.ifError(err);
    assert.ok(packages);
    assert.ok(packages.length);
    test.finish();
  });
};


exports.test_get_package_by_name = function(test, assert) {
  mapi.getPackageByName(CUSTOMER, 'regular_128', function(err, pkg) {
    assert.ifError(err);
    assert.ok(pkg);
    test.finish();
  });
};


exports.test_get_package_by_name_not_found = function(test, assert) {
  mapi.getPackageByName(CUSTOMER, uuid(), function(err, pkg) {
    assert.ok(err);
    assert.ok(!pkg);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_list_machines = function(test, assert) {
  mapi.listMachines(CUSTOMER, function(err, machines) {
    assert.ifError(err);
    assert.ok(machines);
    test.finish();
  });
};


exports.test_list_machines_bad_tenant = function(test, assert) {
  mapi.listMachines(uuid(), function(err, zones) {
    assert.ifError(err);
    assert.ok(zones);
    test.finish();
  });
};


exports.test_list_machines_limit_offset = function(test, assert) {
  var opts = {
    limit: 1,
    offset: 0
  };
  mapi.listMachines(CUSTOMER, opts, function(err, zones) {
    assert.ifError(err);
    assert.ok(zones);
    assert.ok(zones.length);
    test.finish();
  });
};


exports.test_list_machines_limit_offset_empty = function(test, assert) {
  var opts = {
    limit: 1,
    offset: 1000
  };
  mapi.listMachines(CUSTOMER, opts, function(err, zones) {
    assert.ifError(err);
    assert.ok(zones);
    assert.equal(zones.length, 0);
    test.finish();
  });
};


exports.test_list_machines_no_vms = function(test, assert) {
  var opts = {
    type: 'vm'
  };
  mapi.listMachines(CUSTOMER, opts, function(err, zones) {
    assert.ifError(err);
    assert.ok(zones);
    assert.equal(zones.length, 0);
    test.finish();
  });
};


exports.test_get_zone_by_alias = function(test, assert) {
  var opts = {
    alias: 'ufds0'
  };
  mapi.listMachines(CUSTOMER, opts, function(err, zones) {
    assert.ifError(err);
    assert.ok(zones);
    assert.equal(zones.length, 1);
    assert.equal(opts.alias, zones[0].alias);
    test.finish();
  });
};


exports.test_get_zone_by_alias_not_found = function(test, assert) {
  var opts = {
    alias: uuid()
  };
  mapi.listMachines(CUSTOMER, opts, function(err, zones) {
    assert.ifError(err);
    assert.ok(zones);
    assert.equal(zones.length, 0);
    test.finish();
  });
};


exports.test_get_machine = function(test, assert) {
  var opts = {
    alias: 'ufds0'
  };
  mapi.listMachines(CUSTOMER, opts, function(err, zones) {
    assert.ifError(err);
    assert.ok(zones);
    mapi.getMachine(CUSTOMER, zones[0].name, function(err, machine) {
      assert.ifError(err);
      assert.ok(machine);
      assert.equal(machine.name, zones[0].name);
      test.finish();
    });
  });
};


exports.test_get_machine_404 = function(test, assert) {
  mapi.getMachine(CUSTOMER, uuid(), function(err, machine) {
    assert.ok(err);
    assert.ok(!machine);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_update_metadata = function(test, assert) {
  mapi.putMachineMetadata(CUSTOMER, ZONE, { foo: 'bar' }, function(err) {
    assert.ifError(err);
    mapi.getMachine(CUSTOMER, ZONE, function(err, machine) {
      assert.ifError(err);
      assert.equal(machine.customer_metadata.foo, 'bar');
      test.finish();
    });
  });
};


exports.test_list_tags = function(test, assert) {
  mapi.listMachineTags(CUSTOMER, ZONE, function(err, tags) {
    assert.ifError(err);
    assert.ok(tags);
    assert.equal(Object.keys(tags).length, 0);
    test.finish();
  });
};


exports.test_create_tags = function(test, assert) {
  var tags = {
    blaze: 'glory',
    fuck: 'off'
  }
  mapi.addMachineTags(CUSTOMER, ZONE, tags, function(err) {
    assert.ifError(err);
    mapi.listMachineTags(CUSTOMER, ZONE, function(err, tags) {
      assert.ifError(err);
      assert.ok(tags);
      assert.equal(tags.blaze, 'glory');
      test.finish();
    });
  });
};


exports.test_get_tag = function(test, assert) {
  mapi.getMachineTag(CUSTOMER, ZONE, 'blaze', function(err, tag) {
    assert.ifError(err);
    assert.equal(tag, 'glory');
    test.finish();
  });
};


exports.test_del_tag = function(test, assert) {
  mapi.deleteMachineTag(CUSTOMER, ZONE, 'blaze', function(err) {
    mapi.getMachineTag(CUSTOMER, ZONE, 'blaze', function(err, tag) {
      assert.ok(err);
      assert.equal(err.httpCode, 404);
      assert.equal(err.restCode, 'ResourceNotFound');
      assert.ok(err.message);
      test.finish();
    });
  });
};


exports.test_del_tags = function(test, assert) {
  mapi.deleteMachineTags(CUSTOMER, ZONE, function(err) {
    mapi.listMachineTags(CUSTOMER, ZONE, function(err, tags) {
      assert.ifError(err);
      assert.ok(tags);
      assert.equal(Object.keys(tags).length, 0);
      test.finish();
    });
  });
};


exports.test_create_snapshot = function(test, assert) {
  mapi.createZoneSnapshot(CUSTOMER, ZONE, 'unitTest', function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports.test_read_snapshots = function(test, assert) {
  mapi.listZoneSnapshots(CUSTOMER, ZONE, function(err, snapshots) {
    assert.ifError(err);
    assert.ok(snapshots);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].name, 'unitTest');
    mapi.getZoneSnapshot(CUSTOMER, ZONE, 'unitTest', function(err, snapshot) {
      assert.ifError(err);
      assert.equal(snapshot.name, 'unitTest');
      test.finish();
    });
  });
};

//
// Thesse are super flaky on timing, so just don't run them
//
// exports.test_shutdown_machine = function(test, assert) {
//   mapi.shutdownMachine(CUSTOMER, ZONE, function(err) {
//     assert.ifError(err);
//     test.finish();
//   });
// };
//
// exports.test_boot_from_snapshot = function(test, assert) {
//   mapi.bootZoneSnapshot(CUSTOMER, ZONE, 'unitTest', function(err) {
//     assert.ifError(err);
//     test.finish();
//   });
// };
//

exports.test_delete_snapshot = function(test, assert) {
  mapi.deleteZoneSnapshot(CUSTOMER, ZONE, 'unitTest', function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports.test_delete_machine = function(test, assert) {
  mapi.deleteMachine(CUSTOMER, ZONE, function(err) {
    assert.ifError(err);
    test.finish();
  });
};


/*
exports.test_list_servers = function(test, assert) {
  mapi.listServers(function(err, servers) {
    assert.ifError(err);
    assert.ok(servers);
    assert.ok(servers.length);
    log.debug('mapi.test: list_servers => %o', servers);
    test.finish();
  });
};


exports.test_update_servers = function(test, assert) {
  mapi.updateServer(1, {reserved: false}, function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports.tearDown = function(test, assert) {
  test.finish();
};
*/
