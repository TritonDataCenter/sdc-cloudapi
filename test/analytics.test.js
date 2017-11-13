/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var test = require('tape').test;
var common = require('./common');


// --- Globals


var CLIENTS;
var CLIENT;
var OTHER;
var SERVER;

var INST_ID;
var CLONE_ID;


// --- Helpers


// since typeof() is kinda terrible, something more useful
function type(obj) {
    if (obj === undefined) {
        return 'undefined';
    } else if (obj === null) {
        return 'null';
    } else if (obj === true || obj === false) {
        return 'boolean';
    } else if (typeof (obj) === 'string') {
        return 'string';
    } else if (typeof (obj) === 'number') {
        return 'number';
    } else if (Array.isArray(obj)) {
        return 'array';
    } else if (typeof (obj) === 'object') {
        return 'object';
    } else {
        // we shouldn't ever get here!
        return 'unknown';
    }
}


function checkTypes(t, types, obj) {
    Object.keys(types).forEach(function (name) {
        var expectedType = types[name];

        t.equal(type(obj[name]), expectedType);
    });
}


function checkHead(t, path) {
    CLIENT.head(path, function (err, req, res, body) {
        t.ifError(err);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 200);
        t.deepEqual(body, {});
        t.end();
    });
}


function checkGetNotFound(t, path) {
    OTHER.get(path, function (err, req, res, body) {
        common.checkNotFound(t, err, req, res, body);
        t.end();
    });
}


function checkHeadNotFound(t, path) {
    OTHER.head(path, function (err, req, res, body) {
        t.ok(err);
        t.equal(res.statusCode, 404);
        t.deepEqual(body, {});
        t.end();
    });
}


function checkInstrumentation(t, inst, justCreated) {
    t.equal(type(inst),  'object');

    if (justCreated) {
        t.equal(inst.module, 'fs');
        t.equal(inst.stat,   'logical_ops');
        t.equal(inst.enabled, true);

        t.deepEqual(inst.predicate,       { eq: [ 'optype', 'read' ] });
        t.deepEqual(inst.decomposition,   [ 'latency' ]);
        t.deepEqual(inst.transformations, {});
    }

    var expectedTypes = {
        module:            'string',
        stat:              'string',
        enabled:           'boolean',
        predicate:         'object',
        decomposition:     'array',
        transformations:   'object',
        id:                'string',
        nsources:          'number',
        granularity:       'number',
        crtime:            'number',
        uris:              'array',
        'value-dimension': 'number',
        'value-arity':     'string',
        'retention-time':  'number',
        'idle-max':        'number',
        'persist-data':    'boolean',
        'value-scope':     'string'
    };

    checkTypes(t, expectedTypes, inst);
}


// --- Tests


test('setup', function (t) {
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        OTHER   = clients.other;
        SERVER  = server;

        t.end();
    });
});


test('DescribeAnalytics OK', function (t) {
    CLIENT.get('/my/analytics', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.equal(type(body), 'object');
        t.equal(Object.keys(body).length, 5);

        var fields  = body.fields;
        var metrics = body.metrics;
        var modules = body.modules;
        var transforms = body.transformations;
        var types   = body.types;

        t.equal(type(fields),  'object');
        t.equal(type(metrics), 'array');
        t.equal(type(modules), 'object');
        t.equal(type(transforms), 'object');
        t.equal(type(types),   'object');

        Object.keys(fields).forEach(function (fieldName) {
            var field = fields[fieldName];

            t.equal(type(field),       'object');
            t.equal(type(field.label), 'string');
            t.equal(type(field.type),  'string');
        });

        Object.keys(modules).forEach(function (moduleName) {
            var module = modules[moduleName];

            t.equal(type(module),       'object');
            t.equal(type(module.label), 'string');
        });

        Object.keys(types).forEach(function (typeName) {
            var anaType = types[typeName];

            t.equal(type(anaType),       'object');
            t.equal(type(anaType.arity), 'string');
            t.equal(type(anaType.unit),  'string');
            t.equal(type(anaType.name),  'string');

            if (anaType.abbr) {
                t.equal(type(anaType.abbr), 'string');
            }

            if (anaType.base) {
                t.equal(type(anaType.base), 'number');
            }

            if (anaType.power) {
                t.equal(type(anaType.power), 'number');
            }
        });

        Object.keys(transforms).forEach(function (transformName) {
            var transform = transforms[transformName];

            t.equal(type(transform),        'object');
            t.equal(type(transform.label),  'string');
            t.equal(type(transform.fields), 'array');

            transform.fields.forEach(function (field) {
                t.equal(type(field), 'string');
            });
        });

        var expectedMetricTypes = {
            module:   'string',
            stat:     'string',
            label:    'string',
            interval: 'string',
            fields:   'array'
        };

        Object.keys(metrics).forEach(function (metricName) {
            var metric = metrics[metricName];

            t.equal(type(metric), 'object');
            checkTypes(t, expectedMetricTypes, metric);

            metric.fields.forEach(function (field) {
                t.equal(type(field), 'string');
            });

            if (metric.unit) {
                t.equal(type(metric.unit), 'string');
            }
        });

        t.end();
    });
});



test('HeadAnalytics OK', function (t) {
    checkHead(t, '/my/analytics');
});



test('CreateInstrumentation OK', function (t) {
    var args = {
        module: 'fs',
        stat: 'logical_ops',
        decomposition: 'latency',
        predicate: '{"eq": ["optype","read"]}'
    };

    CLIENT.post('/my/analytics/instrumentations', args,
                function (err, req, res, body) {
        t.ifError(err);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 200);

        var path_re = /^\/[^\/]+\/analytics\/instrumentations\/\d+$/;
        t.ok(res.headers.location.match(path_re));

        checkInstrumentation(t, body, true);

        INST_ID = body.id;

        t.end();
    });
});



test('GetInstrumentation OK', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID;

    CLIENT.get(path, function (err, req, res, body) {
        t.ifError(err);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 200);

        checkInstrumentation(t, body, true);

        t.end();
    });
});



test('GetInstrumentation other', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID;

    checkGetNotFound(t, path);
});



test('HeadInstrumentation OK', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID;

    checkHead(t, path);
});



test('HeadInstrumentation other', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID;

    checkHeadNotFound(t, path);
});



test('GetInstrumentationValue OK', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID + '/value/raw';

    CLIENT.get(path, function (err, req, res, body) {
        t.ifError(err);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 200);

        var expectedTypes = {
            value:           'array',
            transformations: 'object',
            start_time:      'number',
            duration:        'number',
            end_time:        'number',
            nsources:        'number',
            minreporting:    'number',
            requested_start_time: 'number',
            requested_duration:   'number',
            requested_end_time:   'number'
        };

        checkTypes(t, expectedTypes, body);

        t.end();
    });
});



test('GetInstrumentationValue other', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID + '/value/raw';

    checkGetNotFound(t, path);
});



test('HeadInstrumentationValue OK', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID + '/value/raw';

    checkHead(t, path);
});



test('HeadInstrumentationValue other', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID + '/value/raw';

    checkHeadNotFound(t, path);
});



test('GetInstrumentationHeatmap OK', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID +
                '/value/heatmap/image';

    CLIENT.get(path, function (err, req, res, body) {
        t.ifError(err);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 200);

        var expectedTypes = {
            nbuckets:     'number',
            width:        'number',
            height:       'number',
            ymin:         'number',
            ymax:         'number',
            present:      'array',
            image:        'string',
            start_time:   'number',
            duration:     'number',
            end_time:     'number',
            nsources:     'number',
            minreporting: 'number',
            transformations:      'object',
            requested_start_time: 'number',
            requested_duration:   'number',
            requested_end_time:   'number'
        };

        checkTypes(t, expectedTypes, body);

        t.end();
    });
});



test('GetInstrumentationHeatmap other', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID +
                '/value/heatmap/image';

    checkGetNotFound(t, path);
});



test('HeadInstrumentationHeatmap OK', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID +
                '/value/heatmap/image';

    checkHead(t, path);
});



test('HeadInstrumentationHeatmap other', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID +
                '/value/heatmap/image';

    checkHeadNotFound(t, path);
});



test('GetInstrumentationHeatmapDetails OK', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID +
                '/value/heatmap/details';

    CLIENT.get(path, function (err, req, res, body) {
        // XX erring out, probably needs a VM started up for this first

        t.end();
    });
});



test('GetInstrumentationHeatmapDetails other', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID +
                '/value/heatmap/details';

    checkGetNotFound(t, path);
});



test('HeadInstrumentationHeatmapDetails OK', function (t) {
    // XX erring out, probably needs a VM started up for this first
    //
    // var path = '/my/analytics/instrumentations/' + INST_ID +
    //            '/value/heatmap/detail';
    //
    // checkHead(t, path);
    t.end();
});



test('HeadInstrumentationHeatmapDetails other', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID +
                '/value/heatmap/detail';

    checkHeadNotFound(t, path);
});



test('ListInstrumentations OK', function (t) {
    var path = '/my/analytics/instrumentations';

    CLIENT.get(path, function (err, req, res, body) {
        t.ifError(err);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 200);

        t.equal(type(body), 'array');

        body.forEach(function (instrumentation) {
            checkInstrumentation(t, instrumentation);
        });

        // this will probably be a bit brittle in some testing environments,
        // but for security reasons we still want to check that there aren't
        // any unexpected instrumentations active (e.g. leaking between users)
        t.equal(body.length, 1);

        t.end();
    });
});



test('HeadInstrumentations OK', function (t) {
    var path = '/my/analytics/instrumentations';

    checkHead(t, path);
});



test('CloneInstrumentation OK', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID;

    CLIENT.post(path, { action: 'clone' }, function (err, req, res, body) {
        t.ifError(err);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 200);

        var path_re = /^\/[^\/]+\/analytics\/instrumentations\/\d+$/;
        t.ok(res.headers.location.match(path_re));

        checkInstrumentation(t, body, true);

        CLONE_ID = body.id;
        t.ok(CLONE_ID !== INST_ID);

        t.end();
    });
});



test('CloneInstrumentation other', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID;

    OTHER.post(path, { action: 'clone' }, function (err, req, res, body) {
        t.ok(err);
        t.ok(body);

        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);

        t.equal(body.code, 'ResourceNotFound');
        t.ok(body.message);

        t.equal(res.statusCode, 404);

        t.end();
    });
});


// PUBAPI-923
test('Check analytics roles are preserved', function (t) {
    var roleName = 'foobarbaz';
    var instrumentationsPath = '/my/analytics/instrumentations';
    var clonePath, rolePath;

    // ||role-tag||Array||The list role-tags to be added to this resource||
    function createRole(next) {
        var args = { name: roleName };

        CLIENT.post('/my/roles', args, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 201);
            rolePath = res.headers.location;

            next();
        });
    }

    function createClone(next) {
        var path = instrumentationsPath + '/' + INST_ID;

        CLIENT.post(path, { action: 'clone' }, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            clonePath = res.headers.location;

            next();
        });
    }

    function addRole(next) {
        var args = { 'role-tag': [ roleName ] };

        CLIENT.put(instrumentationsPath, args, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            next();
        });
    }

    function deleteClone(next) {
        CLIENT.del(clonePath, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            next();
        });
    }

    function checkRole(next) {
        CLIENT.head(instrumentationsPath, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            t.equal(res.headers['role-tag'], roleName);
            next();
        });
    }

    function removeRole(next) {
        var args = { 'role-tag': [] };

        CLIENT.put(instrumentationsPath, args, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 200);
            next();
        });
    }

    function deleteRole(next) {
        CLIENT.del(rolePath, function (err, req, res, body) {
            t.ifError(err);
            t.equal(res.statusCode, 204);
            next();
        });
    }

    // deleting a role doesn't remove the sdcaccountresource object, but if we
    // want to remove the test user after this test, we cannot have a child
    // object on the user in LDAP
    function deleteResourceObject(next) {
        var account = CLIENT.account;
        var name = '/' + account.login + '/analytics/instrumentations';

        CLIENT.ufds.getResource(account.uuid, name, function (err, resource) {
            t.ifError(err);

            CLIENT.ufds.deleteResource(account.uuid, resource.uuid, next);
        });
    }


    function runStep(steps) {
        if (steps.length === 0) {
            return t.end();
        }

        var next = steps.shift();

        return next(function () {
            runStep(steps);
        });
    }

    runStep([createRole, createClone, addRole, deleteClone, checkRole,
            removeRole, deleteRole, deleteResourceObject]);
});


test('DeleteInstrumentation other', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID;

    OTHER.del(path, function (err, req, res, body) {
        t.ok(err);
        t.ok(body);

        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);

        t.equal(body.code, 'ResourceNotFound');
        t.ok(body.message);

        t.equal(res.statusCode, 404);

        CLIENT.get(path, function (err2, req2, res2, body2) {
            t.equal(res2.statusCode, 200);
            t.end();
        });
    });
});



test('DeleteInstrumentation OK', function (t) {
    var path = '/my/analytics/instrumentations/' + INST_ID;

    CLIENT.del(path, function (err, req, res, body) {
        t.ifError(err);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 204);
        t.deepEqual(body, {});

        CLIENT.get(path, function (err2, req2, res2, body2) {
            t.equal(res2.statusCode, 404);

            t.deepEqual(err2, {
                jse_info: {},
                jse_shortmsg: '',
                message: 'resource not found',
                statusCode: 404,
                restCode: 'ResourceNotFound',
                name: 'ResourceNotFoundError',
                body: {
                    code: 'ResourceNotFound',
                    message: 'resource not found'
                }
            });

            t.end();
        });
    });
});



test('DeleteInstrumentation other - clone', function (t) {
    if (!CLONE_ID) {
        return t.end();
    }

    var path = '/my/analytics/instrumentations/' + CLONE_ID;

    return OTHER.del(path, function (err, req, res, body) {
        t.ok(err);
        t.ok(body);

        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);

        t.equal(body.code, 'ResourceNotFound');
        t.ok(body.message);

        t.equal(res.statusCode, 404);

        t.end();
    });
});



test('DeleteInstrumentation OK - clone', function (t) {
    if (!CLONE_ID) {
        return t.end();
    }

    var path = '/my/analytics/instrumentations/' + CLONE_ID;

    return CLIENT.del(path, function (err, req, res, body) {
        t.ifError(err);
        common.checkHeaders(t, res.headers);
        t.equal(res.statusCode, 204);
        t.deepEqual(body, {});
        t.end();
    });
});



test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
