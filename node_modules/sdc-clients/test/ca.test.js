// Copyright 2011 Joyent, Inc.  All rights reserved.

var uuid = require('node-uuid');

var CA = require('../lib/index').CA;
var restify = require('restify');


///--- Globals

var CA_URL = 'http://' + (process.env.CA_IP || '10.99.99.24') + ':23181';

var ca = null;
var customer = '930896af-bf8c-48d4-885c-6573a94b1853';
var instrumentation = null;


///--- Tests

exports.setUp = function(test, assert) {
  ca = new CA({
    url: CA_URL,
    retryOptions: {
      retries: 1,
      minTimeout: 1000
    }
  });
  test.finish();
};


exports.test_list_schema = function(test, assert) {
  ca.listSchema(customer, function(err, schema) {
    assert.ifError(err);
    assert.ok(schema);
    test.finish();
  });
};


exports.test_create_instrumentation_bad_params = function(test, assert) {
  ca.createInstrumentation(customer, {}, function(err, instrumentation) {
    assert.ok(err);
    assert.ok(!instrumentation);
    assert.equal(err.httpCode, 409);
    assert.equal(err.restCode, 'InvalidArgument');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_create_instrumentation = function(test, assert) {
  var params = {
    module: 'fs',
    stat: 'logical_ops',
    decomposition: 'latency'
  };
  ca.createInstrumentation(customer, params, function(err, inst) {
    assert.ifError(err);
    assert.ok(inst);
    var uri = inst.uri;
    instrumentation = uri.substr(uri.lastIndexOf('/') + 1);
    test.finish();
  });
};


exports.test_list_instrumentations = function(test, assert) {
  ca.listInstrumentations(customer, function(err, instrumentations) {
    assert.ifError(err);
    assert.ok(instrumentations);
    assert.ok(instrumentations.length);
    var i = instrumentations[instrumentations.length - 1];
    assert.equal(i.module, 'fs');
    assert.equal(i.stat, 'logical_ops');
    test.finish();
  });
};


exports.test_list_instrumentations_bogus_customer = function(test, assert) {
  ca.listInstrumentations(uuid(), function(err, instrumentations) {
    assert.ifError(err);
    assert.ok(instrumentations);
    assert.equal(instrumentations.length, 0);
    test.finish();
  });
};


exports.test_get_instrumentation_bad = function(test, assert) {
  ca.getInstrumentation(customer, uuid(), function(err, instrumentation) {
    assert.ok(err);
    assert.ok(!instrumentation);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_get_instrumentation = function(test, assert) {
  ca.getInstrumentation(customer, instrumentation, function(err, inst) {
    assert.ifError(err);
    assert.ok(inst);
    test.finish();
  });
};


exports.test_get_heatmap = function(test, assert) {
  ca.getHeatmap(customer, instrumentation, function(err, heatmap) {
    assert.ifError(err);
    assert.ok(heatmap);
    test.finish();
  });
};


exports.test_get_heatmap_bad = function(test, assert) {
  ca.getHeatmap(customer, uuid(), function(err, heatmap) {
    assert.ok(err);
    assert.ok(!heatmap);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);

    test.finish();
  });
};


exports.test_get_heatmap_details_bad = function(test, assert) {
  ca.getHeatmapDetails(customer, uuid(), {x:10,y:20}, function(err, heatmap) {
    assert.ok(err);
    assert.ok(!heatmap);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_delete_instrumentation_bad = function(test, assert) {
  ca.deleteInstrumentation(customer, uuid(), function(err) {
    assert.ok(err);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    test.finish();
  });
};


exports.test_clone_instrumentation = function(test, assert) {
  ca.cloneInstrumentation(customer, instrumentation, function(err, inst) {
    assert.ifError(err);
    ca.deleteInstrumentation(customer, inst.id, function(err) {
      assert.ifError(err);
      test.finish();
    });
  });
};


exports.test_delete_instrumentation = function(test, assert) {
  ca.deleteInstrumentation(customer, instrumentation, function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports.tearDown = function(test, assert) {
  test.finish();
};
