/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * CloudAPI Benchmark Suite.
 *
 * Load testing for the most relevant CloudAPI end-points.
 *
 * Relevant Environment variables:
 * - CLOUDAPI_URL: Full CloudAPI URL. (Default: https://10.99.99.38)
 * - UFDS_URL: Full UFDS URL. (Default: ldaps://10.99.99.18)
 * - LOG_LEVEL: Default to 'info'
 * - CONCURRENCY: The desired concurrency for requests. Defaul to 1.
 *
 * Note this suite uses latest CloudAPI version (~7.1).
 *
 * CONCURRENCY=5 ./build/node/bin/node ./bench/bench.js 2>&1 | \
 *      ./node_modules/.bin/bunyan
 *
 * PLEASE, NOTE THIS IS A WIP AND THERE IS NO INTENTION TO AUTOMATE THIS
 * PROCESS, NEITHER STOP USING node-smartdc. ALSO, NOTE THAT THIS FILE FORKS
 * A CHILD PROCESS PER CONCURRENT REQUEST, WHICH THE CONSEQUENT MEMORY LEAKS
 * IF THE GIVEN NUMBER IS TOO BIG.
 *
 * WHILE IT'S STILL FAR BEYOND TO BE COMPLETE, IT ALREADY HAS BEEN USEFUL TO
 * TRACK THINGS LIKE PUBAPI-780.
 *
 * Given we haven't got too many time, I'd rather check it here before I lost
 * it and continue as I can get some free time.
 */

var util = require('util');
var assert = require('assert');
var crypto = require('crypto');
var path = require('path');
var fs = require('fs');

var fork = require('child_process').fork;

var restify = require('restify');
var bunyan = require('bunyan');
var libuuid = require('libuuid');
var vasync = require('vasync');

// TO BE REMOVED as soon as we update to a version of vasync >= 1.3.1:

/*
 * Exactly like pipeline, except that the input is specified as a single
 * function to invoke on N different inputs (rather than N functions).  "args"
 * must have the following fields:
 *
 * func     asynchronous function to invoke on each input value
 *
 * inputs   array of input values
 */
function forEachPipeline(args, callback) {
    assert.equal(typeof (args), 'object', '"args" must be an object');
    assert.equal(typeof (args.func), 'function',
            '"args.func" must be specified and must be a function');
    assert.ok(Array.isArray(args.inputs),
            '"args.inputs" must be specified and must be an array');
    assert.equal(typeof (callback), 'function',
        'callback argument must be specified and must be a function');

    var func = args.func;

    var funcs = args.inputs.map(function (input) {
        return (function (_, subcallback) {
            return (func(input, subcallback));
        });
    });

    return (vasync.pipeline({'funcs': funcs}, callback));
}

vasync.forEachPipeline = forEachPipeline;

var UFDS = require('sdc-clients').UFDS;
var common = require('./common');

// --- Globals:
var PASSWD = 'secret123';
var DEFAULT_CFG = path.join(__dirname, '..', '/etc/cloudapi.cfg');
var LOG =  new bunyan({
    level: process.env.LOG_LEVEL || 'info',
    name: 'cloudapi_benchmark',
    stream: process.stderr,
    serializers: restify.bunyan.serializers
});



var config = {};
try {
    config = JSON.parse(fs.readFileSync(DEFAULT_CFG, 'utf8'));
} catch (e) {}


var ufds;

// Expected "total" to be increased by each message being sent to a child
// process, and "completed" with every message received from a child process,
// so we can report progress and finish the whole process on completion:
var total = 0;
var completed = 0;

// Number of Spec items:
var totalSteps = 0;
var completeSteps = 0;

// Total requests for the current step iteration:
var totalStepItems = 0;
var doneStepItems = 0;

var aSpec;
var specItems = [];
var onExit;


// Forked child processes. Key is the child process PID.
var children = {};

function childCount() {
    return Object.keys(children).length;
}

// Just in case we need to kill it without leaving child processes around:
function kill(cb) {
    if (childCount() > 0) {
        Object.keys(children).forEach(function (p) {
            process.kill(p, 'SIGKILL');
            LOG.info({pid: p}, 'Killing child process');
        });
        children = {};
        if (cb) {
            cb();
        }
    } else {
        if (cb) {
            cb();
        }
    }
}

// Returns the array index for the element incuding an uuid with the
// given value:
function _getSpecIndex(uuid) {
    var i = -1;
    for (i = 0; i < aSpec.length; i += 1) {
        if (aSpec[i].uuid === uuid) {
            break;
        }
    }
    return i;
}

function percentile(values, p) {
    var rank = Math.round((p / 100) * values.length + 0.5);
    return (values[rank - 1]);
}

function printTotals() {
    var totals = [];
    var i;
    for (i = 0; i < aSpec.length; i += 1) {
        totals[i] = {
            methodName: aSpec[i].method,
            args: aSpec[i].args,
            concurrency: aSpec[i].concurrency,
            completeRequests: aSpec[i].totals.length,
            contentLength: aSpec[i].totals[0].contentLength,
            responseCodes: [],
            responseTimes: {}
        };
        var resTimes = aSpec[i].totals.map(function (j) {
            totals[i].responseCodes.push(j.statusCode);
            return parseInt(j.responseTime, 0);
        });
        resTimes.sort();
        totals[i].responseTimes.raw = resTimes;

        totals[i].responseTimes.max = Math.max.apply(Math, resTimes);
        totals[i].responseTimes.min = Math.min.apply(Math, resTimes);
        totals[i].responseTimes.mean = (resTimes.reduce(function (x, y) {
            return (x + y);
        }) / resTimes.length);
        totals[i].responseTimes.perc45 = percentile(resTimes.sort(), 45);
        totals[i].responseTimes.perc95 = percentile(resTimes.sort(), 95);

        console.log(util.inspect(totals[i], false, 8, true));
    }
}

function forkAChild(_, cb) {
    var child;
    try {
        child = fork(__dirname + '/child.js', [], {
            env: process.env
        });
    } catch (e) {
        return cb(e);
    }

    try {
        LOG.info('Forked child process with pid %d', child.pid);
        children[child.pid] = child;
        child.on('message', function (msg) {
            completed += 1;
            doneStepItems += 1;
            var idx = _getSpecIndex(msg.uuid);
            var theSpec;
            if (idx !== -1) {
                theSpec = aSpec[idx];
                if (!theSpec.totals) {
                    theSpec.totals = [];
                }
                theSpec.totals.push({
                    contentLength: msg.headers['content-length'],
                    statusCode: msg.statusCode,
                    responseTime: msg.headers['response-time']
                });
                // Do stuff here:
                if (msg.error) {
                    LOG.error({err: msg.error});
                } else {
                    LOG.info(msg);
                    // Expected msg.response and msg.obj
                }
            }


            // We've finished the current spec item, let's move into the next
            // or finish if we're at latest:
            if (doneStepItems >= totalStepItems) {
                completeSteps += 1;
                if (totalSteps > completeSteps) {
                    // Queue next step item to be run
                    runNextItem();
                } else {
                    // We're done, let's finish this
                    // Print totals here & exit:
                    printTotals();
                    LOG.info('All processes completed');
                    onExit();
                }
            }
        });
    } catch (ex) {
        if (child.pid) {
            Object.keys(children).forEach(function (p) {
                if (p === child.pid) {
                    delete children[p];
                }
            });
        }
        LOG.error({err: ex}, 'Child process error');
    }
    return cb();
}

// Will call the callback with error in case of failure
function forkChildProcesses(x, cb) {
    var n = x - Object.keys(children).length;
    if (n <= 0) {
        return cb(null);
    }
    var inputs = [];
    while (inputs.length < n) {
        inputs.push(inputs.length + 1);
    }
    return vasync.forEachParallel({
        'func': forkAChild,
        'inputs': inputs
    }, function (err, res) {
        if (err) {
            cb(err);
        } else {
            cb(null);
        }
    });
}


/*
 * Creates a UFDS client.
 * - cb (Function) will be called with error on failure
 */
function createUFDSClient(cb) {
    ufds = new UFDS({
        url: (process.env.UFDS_URL || config.ufds.url || 'ldaps://10.99.99.18'),
        bindDN: (config.ufds.bindDN || 'cn=root'),
        bindPassword: (config.ufds.bindPassword || 'secret'),
        log: LOG,
        tlsOptions: {
            rejectUnauthorized: false
        }
    });

    ufds.once('error', function (err) {
        return cb(err);
    });

    ufds.once('connect', function () {
        LOG.info('UFDS Connected');
        return cb(null);
    });
}

/*
 * Close the UFDS client after removing all listeners
 */
function closeUFDSClient(cb) {
    ufds.client.removeAllListeners('close');
    ufds.client.removeAllListeners('timeout');
    ufds.removeAllListeners('timeout');
    ufds.close(function () {
        return cb();
    });
}

/*
 * Add a user to UFDS.
 *
 * cb(err, user)
 *
 * Where user will be an object with members:
 * {
 *      account: The user account,
 *      pubKey: User public key,
 *      privKey: User private key
 * }
 */
function createUFDSUser(callback) {

    var user = 'test' + libuuid.create().substr(0, 7) + '@joyent.com';

    var entry = {
        login: user,
        email: user,
        userpassword: PASSWD,
        registered_developer: true
    };

    ufds.addUser(entry, function (err, customer) {
        if (err) {
            return callback(err);
        }

        var p = __dirname + '/id_rsa';
        return fs.readFile(p + '.pub', 'ascii', function (er1, data) {
            if (er1) {
                return callback(er1);
            }
            var obj = {
                openssh: data,
                name: 'id_rsa'
            };
            return customer.addKey(obj, function (er2, key) {
                if (er2) {
                    return callback(er2);
                }
                return fs.readFile(p, 'ascii', function (er3, d) {
                    if (er3) {
                        return callback(er3);
                    }
                    return callback(null, {
                        account: customer,
                        pub_key: data,
                        priv_key: d,
                        fp: '66:ca:1c:09:75:99:35:69:be:91:08:25:03:c0:17:c0'
                    });
                });
            });
        });
    });
}

/*
 * Cleanup the given user (& ssh key) from UFDS
 */
function cleanupUser(user, cb) {
    ufds.deleteKey(user, 'id_rsa', function (er1) {
        if (er1) {
            return cb(er1);
        }
        return ufds.deleteUser(user, function (er2) {
            if (er2) {
                return cb(er2);
            }
            return cb(null);
        });
    });
}



function parallel(_spec, cb) {
    var concurrency = _spec.concurrency;
    doneStepItems = 0;
    // We'll fork up to "concurrency" child processes here when required:
    forkChildProcesses(concurrency, function (err) {
        if (err) {
            LOG.error({err: err}, 'Error forking child processes');
            onExit(1);
        } else {
            var inputs = Object.keys(children);
            // If we have a method with smaller concurrency than the global one,
            // just run it the desired number of times:
            if (concurrency < inputs.length) {
                inputs = inputs.slice(0, concurrency);
            }
            totalStepItems = inputs.length;
            vasync.forEachParallel({
                'inputs': inputs,
                'func': function (pid, next) {
                    total += 1;
                    children[pid].send({
                        user: _spec.user.account.login,
                        key: _spec.user.priv_key,
                        fp: _spec.user.fp,
                        method: _spec.method,
                        args: _spec.args,
                        uuid: _spec.uuid
                    });
                    next();
                }
            }, function (err2, res) {
                if (err2) {
                    LOG.error({err: err2}, 'vasync.forEachParallel Error');
                    cb(err2);
                } else {
                    LOG.debug(res);
                    cb(null);
                }
            });
        }
    });
}


// Shift the next element from specItems and run it:
function runNextItem() {
    var nextItem = specItems.shift();
    parallel(nextItem, function (err) {
        if (err) {
            LOG.error({err: err}, 'Error queueing spec item');
        } else {
            LOG.info('Spec item queued');
        }
    });
}


// Currently, this is pretty weak as in it relies into the assumption
// that no child process will dead in the middle of the spec run?:
function runSpec(spec) {
    vasync.forEachPipeline({
        inputs: spec,
        func: function (item, next) {
            specItems.push(item);
            next();
        }
    }, function (err, res) {
        totalSteps = specItems.length;
        if (err) {
            LOG.error({err: err}, 'vasync.forEachPipeline Error');
        }
        LOG.trace(res);
        runNextItem();
    });
}


if (require.main === module) {

    var specFile = process.env.SPEC || path.join(__dirname, 'spec.json');
    try {
        aSpec = JSON.parse(fs.readFileSync(specFile, 'utf8')).spec;
    } catch (e) {}

    createUFDSClient(function (err) {
        if (err) {
            LOG.error({err: err}, 'Unexpected UFDS Error');
            process.exit(1);
        }

        createUFDSUser(function (er1, user) {
            if (er1) {
                LOG.error({err: er1}, 'Error Creating UFDS User');
                closeUFDSClient(function () {
                    process.exit(1);
                });
            }

            onExit = function (code) {
                kill(function () {
                    cleanupUser(user.account.login, function () {
                        closeUFDSClient(function () {
                            process.exit(code || 0);
                        });
                    });
                });
            };

            process.on('SIGINT', function () {
                console.log(
                    'Got SIGINT. Waiting for child processes');
                onExit(0);
            });

            process.on('SIGTERM', function () {
                console.log('Got SIGTERM. Finishing child processes');
                onExit(0);
            });

            var s = 0;
            for (s = 0; s < aSpec.length; s += 1) {
                aSpec[s].user = user;
                if (!aSpec[s].uuid) {
                    aSpec[s].uuid = libuuid.create();
                }
                if (!aSpec[s].concurrency) {
                    aSpec[s].concurrency = process.env.CONCURRENCY || 1;
                }
            }
            runSpec(aSpec);
        });
    });

}

// TODO:
// - Pretty print totals.
