// Copyright 2014 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var fs = require('fs');
var http = require('http');
var https = require('https');
var util = require('util');
var path = require('path');

var Logger = require('bunyan');
var restify = require('restify');
var SDC = require('sdc-clients');
var keyapi = require('keyapi');

var account = require('./account');
var analytics = require('./analytics');
var auth = require('./auth');
var datacenters = require('./datacenters');
var datasets = require('./datasets');
var docs = require('./docs');
var keys = require('./keys');
var machines = require('./machines');
var metadata = require('./metadata');
var packages = require('./packages');
var snapshots = require('./snapshots');
var tags = require('./tags');
var throttle = require('./throttle');
var networks = require('./networks');
var audit = require('./audit');
var auditLogger = require('./audit_logger');
var rules = require('./rules');

// Account users, roles and groups:
var users = require('./users');
var roles = require('./roles');
var groups = require('./groups');

// PUBAPI-646: Backwards compatible authorization parser
var authorizationParser = require('./authorization');

// --- Globals

var HTML_FMT = '<html><head /><body><p>%s</p></body></html>\n';
var VERSION = false;
var sprintf = util.format;

var userThrottle = throttle.getUserThrottle;
var ipThrottle = throttle.getIpThrottle;



// --- Internal functions

/**
 * Returns the current semver version stored in CloudAPI's package.json.
 * This is used to set in the API versioning and in the Server header.
 *
 * @return {String} version.
 */
function version() {
    if (!VERSION) {
        var pkg = fs.readFileSync(__dirname + '/../package.json', 'utf8');
        VERSION = JSON.parse(pkg).version;
    }

    return VERSION;
}




/**
 * Creates an SDC.UFDS client instance pointing to the UFDS server provided
 * in options. callback will be called either with Error - cb(err) - or
 * with the recently instantiated client object: cb(null, ufds_client)
 */
function createUfdsClient(options, callback) {
    var ufds = new SDC.UFDS2(options);

    ufds.once('connect', function () {
        ufds.removeAllListeners('error');
        ufds.on('error', function (err) {
            options.log.error(err, 'UFDS disconnected');
        });
        ufds.on('connect', function () {
            options.log.info('UFDS reconnected');
        });
        callback(null, ufds);
    });

    ufds.once('error', function (err) {
        // You are screwed. It's likely that the bind credentials were bad.
        // Treat this as fatal and move on:
        options.log.error({err: err}, 'UFDS connection error');
        callback(err);
    });

    // Prevent process exiting due to LDAP client emitting "OtherError" on
    // request timeout:
    // JPC-1217: The following is making CloudAPI raise pretty much every
    // exception, including server.on('uncaughtException'). Commenting out for
    // testing.
    // process.on('uncaughtException', function preventOtherError(e) {
    //    if (e && e.name && e.name === 'OtherError' &&
    //        /request\stimeout/.test(e.message)) {
    //        return;
    //    } else {
    //        throw e;
    //    }
    // });
}


function createHTTPClients(options) {
    return {
        ca: new SDC.CA(options.ca),
        vmapi: new SDC.VMAPI(options.vmapi),
        napi: new SDC.NAPI(options.napi),
        fwapi: new SDC.FWAPI(options.fwapi),
        imgapi: new SDC.IMGAPI.createClient(options.imgapi),
        keyapi: new keyapi(options)
    };
}


function createClients(options, callback) {
    assert.ok(options);
    assert.ok(options.ca);
    assert.ok(options.vmapi);
    assert.ok(options.napi);
    assert.ok(options.imgapi);
    assert.ok(options.ufds);
    assert.ok(options.ufds_master);
    assert.ok(options.keyapi);

    options.ufds.log = options.log;
    options.ufds_master.log = options.log;
    options.ca.log = options.log;
    options.vmapi.log = options.log;
    options.napi.log = options.log;
    options.imgapi.log = options.log;

    // On this case, we'll point pkg and ufds to the same UFDS server,
    // given we're running into "ufds-master" headnode
    var ufds_is_master = (options.ufds_master.url === 'ldaps://');

    // Single ufds server
    if (ufds_is_master) {
        createUfdsClient(options.ufds, function (err, ufds) {
            if (err) {
                return callback(err);
            }
            var clients = createHTTPClients(options);
            clients.ufds = ufds;
            clients.pkg = new SDC.Package(options.ufds);
            clients.ufds_master = ufds;
            clients.is_ufds_master = true;
            return callback(null, clients);
        });
    } else {
        // Master and HN local UFDS servers:
        createUfdsClient(options.ufds_master, function (err, ufds_master) {
            if (err) {
                return callback(err);
            }
            return createUfdsClient(options.ufds, function (err2, ufds) {
                if (err2) {
                    return callback(err2);
                }
                var clients = createHTTPClients(options);
                clients.ufds = ufds;
                clients.ufds_master = ufds_master;
                clients.is_ufds_master = false;
                clients.pkg = new SDC.Package(options.ufds);
                return callback(null, clients);
            });
        });
    }
}


/**
 * Load enabled pre|post provision plugins
 *
 * @param {Array} where each member is an {Object} representing a plugin config
 * @returns {Object} with first member being preProvision methods to call, and
 *          second member postProvision
 */

function loadPlugins(plugins, log) {
    assert.ok(plugins);
    // Load enabled pre|post provision plugins:
    var p = {};
    var cfg = {};
    var preProvision = [];
    var postProvision = [];
    var pluginsDir = path.resolve(__dirname, '../plugins');
    plugins.forEach(function (plugin) {
        if (plugin.enabled) {
            log.info('Loading plugin: %s', plugin.name);
            cfg[plugin.name] = plugin.config;
            p[plugin.name] = require(util.format(
                    pluginsDir + '/%s', plugin.name));
            if (typeof (p[plugin.name].preProvision) === 'function') {
                preProvision.push(p[plugin.name].preProvision(
                        cfg[plugin.name]));
            }

            if (typeof (p[plugin.name].postProvision) === 'function') {
                postProvision.push(p[plugin.name].postProvision(
                        cfg[plugin.name]));
            }
        }
    });

    return [preProvision, postProvision];
}


// --- API

module.exports = {

    createServer: function (config, callback) {

        var log = config.log;
        var globalAgentInterval;
        var server;
        var machineThrottle;

        config.name = 'Joyent SmartDataCenter ' + version();
        config.version = [version(), '7.0.0', '6.5.0'];
        config.formatters = {
            'text/html': function formatHTML(req, res, body) {
                if (typeof (body) === 'string') {
                    return body;
                }

                var html;
                if (body instanceof Error) {
                    html = sprintf(HTML_FMT, body.stack);
                } else if (Buffer.isBuffer(body)) {
                    html = sprintf(HTML_FMT, body.toString('base64'));
                } else {
                    html = sprintf(HTML_FMT, body.toString());
                }

                return html;
            },
            'text/css': function formatCSS(req, res, body) {
                if (typeof (body) === 'string') {
                    return body;
                }

                return '';
            },

            'image/png': function formatPNG(req, res, body) {
                return body;
            }
        };

        return createClients(config, function (error, clients) {
            if (error) {
                log.error({err: error}, 'Create clients error');
                throw error;
            }
            // ufds client itself comes plenty of listeners to buble up
            // ldap client events. Let's sightly increase limits
            clients.ufds.setMaxListeners(15);
            clients.ufds.on('timeout', function (msg) {
                log.warn({message: msg},
                    'local UFDS client timeout (recycling)');
                // server.emit('uncaughtException', req, res, null,
                //    new restify.InternalError('Backend Timeout Error'));
                try {
                    clients.ufds.client.socket.destroy();
                } catch (e) {
                    log.fatal({err: e},
                        'could not destroy the timed out local UFDS socket');
                }
            });

            if (!clients.is_ufds_master) {
                clients.ufds_master.setMaxListeners(15);
                clients.ufds_master.on('timeout', function (msg) {
                    log.warn({message: msg},
                        'UFDS Master client timeout (recycling)');
                    //server.emit('uncaughtException', req, res, null,
                    //    new restify.InternalError('Backend Timeout Error'));
                    try {
                        clients.ufds.client.socket.destroy();
                    } catch (e) {
                        log.fatal({err: e},
                        'could not destroy the timed out master UFDS socket');
                    }
                });
            }

            server = restify.createServer(config);

            server.use(restify.acceptParser(server.acceptable));
            server.use(authorizationParser());
            server.use(restify.dateParser());
            server.use(restify.queryParser());
            server.use(restify.requestLogger());
            server.use(restify.bodyParser({
                overrideParams: true,
                mapParams: true
            }));
            server.use(restify.fullResponse());

            server.use(function xForwardedFor(req, res, next) {
                // Stolen from muskie!:
                // This will only be null on the _first_ request, and in
                // that instance, we're guaranteed that HAProxy sent us
                // an X-Forwarded-For header
                if (!req.connection._xff) {
                    // Clean up clientip if IPv6
                    var xff = req.headers['x-forwarded-for'];
                    if (xff) {
                        /* JSSTYLED */
                        xff = xff.split(/\s*,\s*/).pop() || '';
                        xff = xff.replace(/^(f|:)+/, '');
                        req.connection._xff = xff;
                    } else {
                        req.connection._xff =
                            req.connection.remoteAddress;
                    }
                }
                return next();
            });

            // docs handler here has to run before auth stuff
            docs.mount(server);

            server.use(function setupSDCProxies(req, res, next) {
                req.config = config;
                req.sdc = clients;
                return next();
            });


            // Run authentication and authorization before everything else
            server.use(auth.basicAuth);
            server.use(auth.signatureAuth);
            server.use(auth.tokenAuth);
            server.use(auth.assertAuthenticated);
            server.use(auth.loadAccount);
            server.use(auth.authorize);

            server.use(function sendZeroContentLengthon65(req, res, next) {
                if (req.method === 'HEAD' && /6\.5/.test(req.getVersion())) {
                    res.contentLength = 0;
                }

                return next();
            });

            server.use(function readOnlyMode(req, res, next) {
                if ((req.method === 'PUT' ||
                    req.method === 'POST' ||
                    req.method === 'DELETE') &&
                    typeof (req.config.read_only) !== 'undefined' &&
                    req.config.read_only === true) {
                    return next(new restify.ServiceUnavailableError(
                        'SmartDataCenter is being upgraded'));
                }

                return next();
            });

            server.use(function backCompatXHeaders(req, res, next) {
                res.once('header', function () {
                    if (res.getHeader('Request-Id')) {
                        res.setHeader('X-Request-Id',
                            res.getHeader('Request-Id'));
                    }

                    if (res.getHeader('Api-Version')) {
                        res.setHeader('X-Api-Version',
                            res.getHeader('Api-Version'));
                    }

                    if (res.getHeader('Response-Time')) {
                        res.setHeader('X-Response-Time',
                            res.getHeader('Response-Time'));
                    }
                });
                return next();
            });

            // Save Context for Machines Audit:
            server.use(function saveContext(req, res, next) {
                if (!/\/machines/.test(req.url)) {
                    return next();
                }

                if (req.method !== 'PUT' && req.method !== 'POST' &&
                    req.method !== 'DELETE') {
                    return next();
                }

                var authType = 'signature';

                if (req.authorization.scheme.toLowerCase() === 'basic') {
                    authType = 'basic';
                }

                if (typeof (req.headers['X-Auth-Token']) !== 'undefined') {
                    authType = 'token';
                }

                req._auditCtx = {
                    type: authType,
                    ip: req.connection.remoteAddress
                };

                if (authType === 'basic') {
                    req._auditCtx.user = req.caller.login;
                } else if (req.authorization.signature) {
                    req._auditCtx.keyId = req.authorization.signature.keyId;
                }

                return next();
            });

            // Now mount all the API handlers
            server.use(datasets.load);
            datasets.mount(server, userThrottle(config, 'datasets'), config);

            server.use(packages.loadPackages);
            packages.mount(server, userThrottle(config, 'packages'));

            server.use(networks.load);
            networks.mount(server, userThrottle(config, 'networks'));

            var plugins =  [];
            if (typeof (config.plugins) !== 'undefined' &&
                    Array.isArray(config.plugins)) {
                plugins = loadPlugins(config.plugins, log);
            }

            // Wait for datasets and packages to mount everything else:
            account.mount(server, userThrottle(config, 'account'));
            datacenters.mount(server, userThrottle(config, 'datacenter'));
            keys.mount(server, userThrottle(config, 'keys'));

            machineThrottle = userThrottle(config, 'machines');
            // Make sure we pass the pre|post provision hooks from the plugins
            machines.mount(server, machineThrottle, plugins[0], plugins[1]);
            metadata.mount(server, machineThrottle);
            snapshots.mount(server, machineThrottle);
            tags.mount(server, machineThrottle);
            audit.mount(server, machineThrottle);
            rules.mount(server, machineThrottle);

            analytics.mount(server, userThrottle(config, 'analytics'));
            users.mount(server, userThrottle(config, 'users'));
            roles.mount(server, userThrottle(config, 'roles'));
            groups.mount(server, userThrottle(config, 'groups'));

            // Register an audit logger (avoid it while testing):
            if (typeof (config.test) === 'undefined' ||
                    config.test === false) {
                server.on('after', auditLogger({
                    log: log.child({component: 'audit'})
                }));
            }

            // Closure to wrap up the port setting
            server.start = function start(cb) {
                if (config.read_only === true) {
                    log.warn('Starting Cloud API on read only mode.');
                }
                return server.listen(config.port, cb);
            };

            // Setup a logger on HTTP Agent queueing
            globalAgentInterval = setInterval(function () {
                var agent = http.globalAgent;
                if (agent.requests && agent.requests.length > 0) {
                    log.warn('http.globalAgent queueing, depth=%d',
                                agent.requests.length);
                }

                agent = https.globalAgent;
                if (agent.requests && agent.requests.length > 0) {
                    log.warn('https.globalAgent queueing, depth=%d',
                                agent.requests.length);
                }
            }, 1000);

            // If we make JSON main format, res.send(error) will send our
            // Restify formatted error objects, and properly hide the v8
            // backtrace.
            server.acceptable.unshift('application/json');

            server.on('close', function () {
                clearInterval(globalAgentInterval);
                clients.ufds.close(function (err) {
                    if (err) {
                        throw err;
                    }
                    if (!clients.ufds_master.closed) {
                        clients.ufds_master.close(function (err2) {
                            if (err2) {
                                throw err2;
                            }
                        });
                    }
                });
            });

            server.on('uncaughtException', function (req, res, route, err) {
                var e = new restify.InternalError(err, 'unexpected error');
                req.log.error(e, 'unexpected error');
                res.send(e);
            });

            server._clients = clients;
            return callback(server);

        });


    }


};
