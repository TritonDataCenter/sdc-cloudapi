// Copyright 2011 Joyent, Inc.  All rights reserved.

var uuid = require('node-uuid');

var UFDS = require('../lib/index').UFDS;



///--- Globals

var UFDS_URL = 'ldaps://' + (process.env.UFDS_IP || '10.99.99.21');

var ufds;
var ADMIN_UUID = '930896af-bf8c-48d4-885c-6573a94b1853';
var SSH_KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEAvad19ePSDckmgmo6Unqmd8' +
  'n2G7o1794VN3FazVhV09yooXIuUhA+7OmT7ChiHueayxSubgL2MrO/HvvF/GGVUs/t3e0u4' +
  '5YwRC51EVhyDuqthVJWjKrYxgDMbHru8fc1oV51l0bKdmvmJWbA/VyeJvstoX+eiSGT3Jge' +
  'egSMVtc= mark@foo.local';



///--- Tests

exports.setUp = function(test, assert) {
  ufds = new UFDS({
    url: UFDS_URL,
    bindDN: 'cn=root',
    bindPassword: 'secret'
  });
  ufds.on('ready', function(bound) {
    assert.ok(bound);
    test.finish();
  });
  ufds.on('error', function(err) {
    assert.fail(err);
  });
};


exports.test_get_user = function(test, assert) {
  ufds.getUser('admin', function(err, user) {
    assert.ifError(err);
    assert.equal(user.login, 'admin');
    assert.ok(user.isAdmin);
    assert.ok(user.isAdmin());
    assert.ok(user.groups);
    assert.ok(user.groups());
    assert.equal(user.groups().length, 1);
    assert.equal(user.groups()[0], 'operators');
    ufds.getUser(user, function(err, user2) {
      assert.ifError(err);
      assert.eql(user, user2);
      test.finish();
    });
  });
};


exports.test_get_user_by_uuid = function(test, assert) {
  ufds.getUser(ADMIN_UUID, function(err, user) {
    assert.ifError(err);
    assert.equal(user.login, 'admin');
    assert.ok(user.isAdmin);
    assert.ok(user.isAdmin());
    test.finish();
  });
};


exports.test_get_user_not_found = function(test, assert) {
  ufds.getUser(uuid(), function(err, user) {
    assert.ok(err);
    assert.equal(err.httpCode, 404);
    assert.equal(err.restCode, 'ResourceNotFound');
    assert.ok(err.message);
    assert.ok(!user);
    test.finish();
  });
};


exports.test_authenticate = function(test, assert) {
  ufds.authenticate('admin', 'joypass123', function(err, user) {
    assert.ifError(err);
    assert.ok(user);
    ufds.getUser('admin', function(err, user2) {
      assert.ifError(err);
      assert.equal(user.login, user2.login);
      test.finish();
    });
  });
};


exports.test_authenticate_by_uuid = function(test, assert) {
  ufds.authenticate(ADMIN_UUID, 'joypass123', function(err, user) {
    assert.ifError(err);
    assert.ok(user);
    assert.equal(user.login, 'admin');
    assert.ok(user.isAdmin());
    user.authenticate('joypass123', function(err) {
      assert.ifError(err);
      test.finish();
    });
  });
};


exports.test_add_key = function(test, assert) {
  ufds.getUser('admin', function(err, user) {
    assert.ifError(err);
    user.addKey(SSH_KEY, function(err, key) {
      assert.ifError(err);
      assert.ok(key);
      assert.equal(key.openssh, SSH_KEY);
      test.finish();
    });
  });
};


exports.test_list_and_get_keys = function(test, assert) {
  ufds.getUser('admin', function(err, user) {
    assert.ifError(err);
    user.listKeys(function(err, keys) {
      assert.ifError(err);
      assert.ok(keys);
      assert.ok(keys.length);
      assert.equal(keys[0].openssh, SSH_KEY);
      user.getKey(keys[0].fingerprint, function(err, key) {
        assert.ifError(err);
        assert.ok(key);
        assert.eql(keys[0], key);
        test.finish();
      });
    });
  });
};


exports.test_del_key = function(test, assert) {
  console.log('hi')
  ufds.getUser('admin', function(err, user) {
    assert.ifError(err);
    user.listKeys(function(err, keys) {
      assert.ifError(err);
      user.deleteKey(keys[0], function(err) {
        assert.ifError(err);
        test.finish();
      });
    });
  });
};


exports.test_crud_user = function(test, assert) {
  var entry = {
    login: 'a' + uuid().replace('-', '').substr(0, 7),
    email: uuid() + '@devnull.com',
    userpassword: 'secret'
  };
  ufds.addUser(entry, function(err, user) {
    assert.ifError(err);
    assert.ok(user);
    assert.ok(user.uuid);
    user.phone = '+1 (206) 555-1212';
    user.save(function(err) {
      assert.ifError(err);
      user.destroy(function(err) {
        assert.ifError(err);
        test.finish();
      });
    });
  });
};


exports.test_crud_limit = function(test, assert) {
  ufds.getUser('admin', function(err, user) {
    assert.ifError(err);
    assert.ok(user);
    user.addLimit({ datacenter: 'coal', smartos: '123'}, function(err, limit) {
      assert.ifError(err);
      assert.ok(limit);
      assert.ok(limit.smartos);
      user.listLimits(function(err, limits) {
        assert.ifError(err);
        assert.ok(limits);
        assert.ok(limits.length);
        assert.ok(limits[0].smartos);
        limits[0].nodejs = 234;
        user.updateLimit(limits[0], function(err) {
          assert.ifError(err);
          user.getLimit(limits[0].datacenter, function(err, limit) {
            assert.ifError(err);
            assert.ok(limit);
            assert.ok(limit.smartos);
            assert.ok(limit.nodejs);
            user.deleteLimit(limit, function(err) {
              assert.ifError(err);
              test.finish();
            });
          });
        });
      });
    });
  });
};


exports.tearDown = function(test, assert) {
  ufds.close(function() {
    test.finish();
  });
};
