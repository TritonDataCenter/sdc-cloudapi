var sys = require('sys');
var sdcClients = require('../lib/index');
var restify = require('restify');
var Amon = sdcClients.Amon;

var amon = null;


//---- fixtures

//TODO: change this to the actualy COAL URL once we move to COAL
var AMON_URL = 'http://localhost:8080';

// We hijack the admin user since it's always going to exist.
// TODO: Should use a test user. Might be *using* 'admin' user.
var ADMIN_UUID = '930896af-bf8c-48d4-885c-6573a94b1853';

var MONITOR = {
  'name' : 'test-monitor',
  'contacts': ['email']
};

var MONITOR_2 = {
  'name': 'yunong-monitor',
  'contacts': ['email']
};

var PROBE = {
  'name': 'test-probe',
  'user': ADMIN_UUID,
  'monitor': MONITOR.name,
  'zone': 'global',
  'urn': 'amon:logscan',
  'data': {
    'path': '/tmp/whistle.log',
    'regex': 'tweet',
    'threshold': 2,
    'period': 60
  }
};

var PROBE_2 = {
  'name': 'test-probe-2',
  'user': ADMIN_UUID,
  'monitor': MONITOR.name,
  'zone': 'global',
  'urn': 'amon:logscan',
  'data': {
    'path': '/tmp/whistle.log',
    'regex': 'tweet',
    'threshold': 2,
    'period': 60
  }
};



//---- internal support stuff

/**
 * Run async `fn` on each entry in `list`. Call `cb(error)` when all done.
 * `fn` is expected to have `fn(item, callback) -> callback(error)` signature.
 *
 * From Isaac's rimraf.js.
 */
function asyncForEach(list, fn, cb) {
  if (!list.length) cb()
  var c = list.length
    , errState = null
  list.forEach(function (item, i, list) {
   fn(item, function (er) {
      if (errState) return
      if (er) return cb(errState = er)
      if (-- c === 0) return cb()
    })
  })
}



//---- tests

function cleanupAccount(test, assert) {
  function deleteProbe(probe, callback) {
    amon.deleteProbe(ADMIN_UUID, probe.monitor, probe.name, callback);
  }
  function deleteMonitor(monitor, callback) {
    amon.getMonitor(ADMIN_UUID, MONITOR.name, function(err, monitor) {
      //assert.ifError(err);   // don't error on 404
      if (!monitor) {
        return callback();
      }
      amon.listProbes(ADMIN_UUID, monitor.name, function(err, probes) {
        assert.ifError(err);
        asyncForEach(probes, deleteProbe, function(err) {
          assert.ifError(err);
          setTimeout(function () {
            amon.deleteMonitor(ADMIN_UUID, monitor.name, function (err) {
              setTimeout(function () { callback(err) }, 2000);
            });
          }, 2000);
        });
      });
    });
  }
  
  // Delete all test monitors.
  asyncForEach([MONITOR, MONITOR_2], deleteMonitor, function (err) {
    test.finish();
  });
};

exports.setUp = function(test, assert) {
  sdcClients.setLogLevel('trace');
  amon = new Amon({
    url: AMON_URL
  });

  cleanupAccount(test, assert);
};

exports.test_put_monitor = function(test, assert) {
  amon.putMonitor(ADMIN_UUID, MONITOR, function(err, monitor) {
    assert.ifError(err);
    assert.ok(monitor);
    assert.equal(monitor.name, MONITOR.name);
    assert.equal(monitor.medium, MONITOR.medium);
    test.finish();
  });
};

exports.test_put_probe = function(test, assert) {
  amon.putProbe(ADMIN_UUID, MONITOR.name, PROBE, function(err, probe) {
    assert.ifError(err);
    assert.ok(probe);
    assert.equal(probe.name, PROBE.name);
    assert.equal(probe.monitor, PROBE.monitor);
    assert.equal(probe.zone, PROBE.zone);
    assert.equal(probe.urn, PROBE.urn);
    assert.equal(probe.data.path, PROBE.data.path);
    assert.equal(probe.data.regex, PROBE.data.regex);
    assert.equal(probe.data.threshold, PROBE.data.threshold);
    assert.equal(probe.data.period, PROBE.data.period);
    test.finish();
  });
};

exports.test_list_probes = function(test, assert) {
  amon.putProbe(ADMIN_UUID, MONITOR.name, PROBE_2, function(err, probe) {
    assert.ifError(err);
    assert.ok(probe);

    amon.listProbes(ADMIN_UUID, MONITOR.name, function(err, probes) {
      assert.ifError(err);
      assert.ok(probes);
      assert.equal(probes.length, 2);

      amon.deleteProbe(ADMIN_UUID, MONITOR.name, PROBE_2.name, function(err) {
         assert.ifError(err);
         test.finish();
       });
    });
  });
};

exports.test_get_probe = function(test, assert) {
  amon.getProbe(ADMIN_UUID, MONITOR.name, PROBE.name, function(err, probe) {
    assert.ifError(err);
    assert.ok(probe);
    assert.equal(probe.name, PROBE.name);
    assert.equal(probe.monitor, PROBE.monitor);
    assert.equal(probe.zone, PROBE.zone);
    assert.equal(probe.urn, PROBE.urn);
    assert.equal(probe.data.path, PROBE.data.path);
    assert.equal(probe.data.regex, PROBE.data.regex);
    assert.equal(probe.data.threshold, PROBE.data.threshold);
    assert.equal(probe.data.period, PROBE.data.period);
    test.finish();
  });
};

exports.test_delete_probe = function(test, assert) {
  amon.deleteProbe(ADMIN_UUID, MONITOR.name, PROBE.name, function(err) {
    assert.ifError(err);
    amon.getProbe(ADMIN_UUID, MONITOR.name, PROBE.name, function(err) {
      assert.equal(err.httpCode, 404);
      test.finish();
    });
  });
};

exports.test_list_monitors = function(test, assert) {
  amon.putMonitor(ADMIN_UUID, MONITOR_2, function(err, monitor) {
    assert.ifError(err);
    amon.listMonitors(ADMIN_UUID, function(err, monitors) {
      assert.ifError(err);
      assert.ok(monitors);
      assert.equal(monitors.length, 2, 'Found more than 2 monitors');
      amon.deleteMonitor(ADMIN_UUID, MONITOR_2.name, function(err) {
        assert.ifError(err);
        test.finish();
      });
    });
  });
};

exports.test_get_monitor = function(test, assert) {
  amon.getMonitor(ADMIN_UUID, MONITOR.name, function(err, monitor) {
    assert.ifError(err);
    assert.ok(monitor);
    assert.equal(monitor.name, MONITOR.name);
    assert.equal(monitor.medium, MONITOR.medium);
    test.finish();
  });
};

exports.test_delete_monitor = function(test, assert) {
  amon.deleteMonitor(ADMIN_UUID, MONITOR.name, function(err) {
    assert.ifError(err);
    setTimeout(function () {
      amon.getMonitor(ADMIN_UUID, MONITOR.name, function(err) {
        assert.equal(err.httpCode, 404);
        test.finish();
      });
    }, 3000);
  });
};

exports.tearDown = function(test, assert) {
  cleanupAccount(test, assert);
};
