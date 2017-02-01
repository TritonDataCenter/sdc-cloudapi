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

var checkMachine = require('./common').checkMachine;
var checkNotFound = require('../common').checkNotFound;


// --- Globals


var NEW_RULE = '';


// --- Helpers


function checkForbidden(t, err, req, res, body) {
    t.ok(err);
    t.ok(body);

    t.equal(err.restCode, 'Forbidden');
    t.ok(err.message);

    t.equal(body.code, 'Forbidden');
    t.ok(body.message);

    t.equal(res.statusCode, 403);
}


// --- Tests


module.exports = function (suite, client, other, machine, callback) {
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
            t.equal(body.length, 1, 'rules length');
            checkRule(t, body[0]);
            t.end();
        });
    });


    suite.test('ListRules - other', function (t) {
        other.get(RULES_URL, function (err, req, res, body) {
            t.ifError(err);
            t.deepEqual(body, []);
            t.end();
        });
    });


    suite.test('AddRule - other', function (t) {
        other.post(RULES_URL, {
            rule: 'FROM vm ' + machine +
                ' TO subnet 10.99.99.0/23 ALLOW tcp port 80'
        }, function (err, req, res, body) {
            t.ok(err);

            t.deepEqual(body, {
                code: 'InvalidParameters',
                message: 'Invalid parameters',
                errors: [ {
                    code: 'InvalidParameter',
                    field: 'rule',
                    message: 'Subnet "10.99.99.0/23" is invalid (bits set to ' +
                        'right of mask)'
                } ]
            });

            t.end();
        });
    });


    suite.test('List Rule Machines (not empty set)', function (t) {
        if (RULE_UUID) {
            var p = sprintf(RULE_URL, RULE_UUID) + '/machines';
            client.get(p, function (err, req, res, body) {
                t.ifError(err, 'Error');
                t.equal(200, res.statusCode, 'Status Code');
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


    suite.test('List Rule Machines (not empty set) - other', function (t) {
        if (RULE_UUID) {
            var p = sprintf(RULE_URL, RULE_UUID) + '/machines';
            other.get(p, function (err, req, res, body) {
                // XXX: this should probably be 404, not 403
                checkForbidden(t, err, req, res, body);
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
            t.equal(body.length, 3, 'rules length');

            checkRule(t, body[0]);
            checkRule(t, body[1]);
            checkRule(t, body[2]);

            t.equal(body.filter(function (rule) {
                return rule.description === 'allow all ICMPv4 types';
            }).length, 1);

            t.equal(body.filter(function (rule) {
                return rule.description === 'allow all ICMPv6 types';
            }).length, 1);

            t.equal(body.filter(function (rule) {
                return rule.id === RULE_UUID;
            }).length, 1);

            t.end();
        });
    });


    suite.test('List Machine Rules (not empty set) - other', function (t) {
        var u = '/my/machines/' + machine + '/fwrules';
        other.get(u, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
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


    suite.test('GetRule - other', function (t) {
        if (RULE_UUID) {
            other.get(sprintf(RULE_URL, RULE_UUID),
                    function (err, req, res, body) {
                // XXX: this should probably be 404, not 403
                checkForbidden(t, err, req, res, body);
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


    suite.test('UpdateRule - with rule', function (t) {
        NEW_RULE = 'FROM vm ' + machine +
            ' TO subnet 10.99.99.0/24 ALLOW tcp (PORT 80 AND PORT 443)';

        if (RULE_UUID) {
            client.post(sprintf(RULE_URL, RULE_UUID), {
                rule: NEW_RULE
            }, function (err, req, res, body) {
                t.ifError(err);
                t.equal(200, res.statusCode);
                t.equal(body.rule, NEW_RULE);
                t.equal(body.enabled, false);
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('UpdateRule - without rule', function (t) {
        if (RULE_UUID) {
            client.post(sprintf(RULE_URL, RULE_UUID), {
                enabled: true
            }, function (err, req, res, body) {
                t.ifError(err);
                t.equal(200, res.statusCode);
                t.equal(body.rule, NEW_RULE);
                t.equal(body.enabled, true);
                t.end();
            });
        } else {
            t.end();
        }
    });


    suite.test('UpdateRule - other', function (t) {
        if (RULE_UUID) {
            other.post(sprintf(RULE_URL, RULE_UUID), {
                rule: 'FROM vm ' + machine +
                    ' TO subnet 10.99.99.0/24 ALLOW tcp (port 80 AND port 443)'
            }, function (err, req, res, body) {
                checkForbidden(t, err, req, res, body);
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


    suite.test('EnableRule - other', function (t) {
        if (RULE_UUID) {
            other.post(sprintf(RULE_URL, RULE_UUID) + '/enable', {
            }, function (err, req, res, body) {
                checkForbidden(t, err, req, res, body);
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


    suite.test('DeleteRule - other', function (t) {
        if (RULE_UUID) {
            other.del(sprintf(RULE_URL, RULE_UUID),
                    function (err, req, res, body) {
                checkForbidden(t, err, req, res, body);
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
