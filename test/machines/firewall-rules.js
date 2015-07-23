/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var util = require('util');
var sprintf = util.format;
var libuuid = require('libuuid');

var common = require('../common');
var checkMachine = require('./common').checkMachine;


// --- Tests


module.exports = function (suite, client, machine, callback) {
    if (!machine) {
        return callback();
    }

    // FireWall Rules:
    var RULE_UUID;
    var RULES_URL = '/my/fwrules';
    var RULE_URL = RULES_URL + '/%s';

    function checkRule(t, rule) {
        t.ok(rule.id, 'rule id ok');
        t.ok(rule.rule, 'rule text ok');
        t.ok(typeof (rule.enabled) !== 'undefined', 'rule enabled defined');
    }


    suite.test('ListRules (empty set)', function (t) {
        client.get(RULES_URL, function (err, req, res, body) {
            t.ifError(err, 'Error');
            t.equal(200, res.statusCode, 'Status Code');
            t.ok(Array.isArray(body), 'isArray(body)');
            t.equal(body.length, 0, 'empty array');
            t.end();
        });
    });


    suite.test('AddRule', function (t) {
        client.post(RULES_URL, {
            rule: 'FROM vm ' + machine +
                ' TO subnet 10.99.99.0/24 ALLOW tcp port 80'
        }, function (err, req, res, body) {
            t.ifError(err, 'Error');
            t.ok(body, 'body OK');
            checkRule(t, body);

            if (body.id) {
                RULE_UUID = body.id;
                t.equal(201, res.statusCode, 'Status Code');
                t.equal(body.enabled, false, 'rule enabled');
                t.end();
            } else {
                t.end();
            }
        });
    });


    suite.test('ListRules (not empty set)', function (t) {
        client.get(RULES_URL, function (err, req, res, body) {
            t.ifError(err, 'Error');
            t.equal(200, res.statusCode, 'Status Code');
            t.ok(Array.isArray(body), 'isArray(rules)');
            t.ok(body.length, 'rules length');
            checkRule(t, body[0]);
            t.end();
        });
    });


    suite.test('List Rule Machines (not empty set)', function (t) {
        if (RULE_UUID) {
            var p = sprintf(RULE_URL, RULE_UUID) + '/machines';
            client.get(p, function (err, req, res, body) {
                t.ifError(err, 'Error');
                t.equal(200, res.statusCode, 'Status Code');
                console.log(util.inspect(body, false, 8, true));
                t.ok(Array.isArray(body), 'isArray(machines)');
                t.ok(body.length, 'machines length');
                body.forEach(function (m) {
                    checkMachine(t, m);
                });
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('List Machine Rules (not empty set)', function (t) {
        var u = '/my/machines/' + machine + '/fwrules';
        client.get(u, function (err, req, res, body) {
            t.ifError(err, 'Error');
            t.equal(200, res.statusCode, 'Status Code');
            t.ok(Array.isArray(body), 'isArray(rules)');
            t.ok(body.length, 'rules length');
            checkRule(t, body[0]);
            t.end();
        });
    });


    suite.test('GetRule', function (t) {
        if (RULE_UUID) {
            client.get(sprintf(RULE_URL, RULE_UUID),
                function (err, req, res, body) {
                t.ifError(err);
                t.equal(200, res.statusCode);
                checkRule(t, body);
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('Get unexisting rule', function (t) {
        client.get(sprintf(RULE_URL, libuuid.create()),
            function (err, req, res, body) {
                t.ok(err);
                t.equal(404, res.statusCode);
                t.end();
        });
    });


    suite.test('UpdateRule', function (t) {
        if (RULE_UUID) {
            client.post(sprintf(RULE_URL, RULE_UUID), {
                rule: 'FROM vm ' + machine +
                    ' TO subnet 10.99.99.0/24 ALLOW tcp (port 80 AND port 443)'
            }, function (err, req, res, body) {
                t.ifError(err);
                t.equal(200, res.statusCode);
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('GetUpdatedRule', function (t) {
        if (RULE_UUID) {
            client.get(sprintf(RULE_URL, RULE_UUID),
                function (err, req, res, body) {
                t.ifError(err);
                t.equal(200, res.statusCode);
                checkRule(t, body);
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('EnableRule', function (t) {
        if (RULE_UUID) {
            client.post(sprintf(RULE_URL, RULE_UUID) + '/enable', {
            }, function (err, req, res, body) {
                t.ifError(err);
                t.equal(200, res.statusCode);
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('GetEnabledRule', function (t) {
        if (RULE_UUID) {
            client.get(sprintf(RULE_URL, RULE_UUID),
                function (err, req, res, body) {
                t.ifError(err);
                t.equal(200, res.statusCode);
                checkRule(t, body);
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('DeleteRule', function (t) {
        if (RULE_UUID) {
            client.del(sprintf(RULE_URL, RULE_UUID), function (err, req, res) {
                t.ifError(err);
                t.equal(204, res.statusCode);
                t.end();
            });
        } else {
            t.end();
        }
    });

    return callback();
};
