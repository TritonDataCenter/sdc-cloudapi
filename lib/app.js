/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * Cloud API Application file. All the modules with routes definitions are
 * required from this file. Clients to all the SDC 7 backend APIs are created
 * from this file. Plugins are loaded from this file. All the application
 * server handlers are included, and some of them dfined, into this file.
 *
 */

var assert = require('assert');
var fs = require('fs');
var http = require('http');
var https = require('https');
var util = require('util');
var path = require('path');

var semver = require('semver');
var restify = require('restify');
var SDC = require('sdc-clients');
var UFDS = require('ufds');
var keyapi = require('keyapi');
var mahi = require('mahi');
var cueball = require('cueball');
var kang = require('kang');

var account = require('./account');
var analytics = require('./analytics');
var auth = require('./auth');
var datacenters = require('./datacenters');
var datasets = require('./datasets');
var docs = require('./docs');
var keys = require('./keys');
var machines = require('./machines');
var metadata = require('./metadata');
var mod_config = require('./config');
var nics = require('./nics');
var packages = require('./packages');
var services = require('./services');
var snapshots = require('./snapshots');
var tags = require('./tags');
var throttle = require('./throttle');
var networks = require('./networks');
var audit = require('./audit');
var auditLogger = require('./audit_logger');
var rules = require('./rules');

// Account users, roles and policies:
var users = require('./users');
var policies = require('./policies');
var roles = require('./roles');
// Account virtual resources:
var resources = require('./resources');

var APERTURE_CFG = path.join(__dirname, '..', '/etc/aperture.json');

var apertureConfig = {};
try {
    apertureConfig = JSON.parse(fs.readFileSync(APERTURE_CFG, 'utf8'));
} catch (e) {
    apertureConfig = {
        typeTable: {
            ip: 'ip',
            requestip: 'ip',
            tag: 'string'
        }
    };
}

// PUBAPI-646: Backwards compatible authorization parser
var authorizationParser = require('./authorization');

// --- Globals

var HTML_FMT = '<html><head /><body><p>%s</p></body></html>\n';
var VERSION = false;
var sprintf = util.format;

var userThrottle = throttle.getUserThrottle;
var ipThrottle = throttle.getIpThrottle;

var MORAY_POLL = 5000; // in ms



// --- Internal functions


function translatePlugin(pl) {
    var plugin = {
        name: pl.cn,
        enabled: (pl.enabled === 'true'),
        config: {
            datacenter: pl.datacenter,
            defaults: []
        }
    };

    // a single 'defaults' entry will not be returned as an array, wrap it.
    if (!Array.isArray(pl.defaults)) {
        pl.defaults = [pl.defaults];
    }

    pl.defaults.forEach(function (d) {
        try {
            d = JSON.parse(d);
            plugin.config.defaults.push(d);
        } catch (e) {}
    });

    return (plugin);
}


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
 * Creates a UFDS client instance pointing to the UFDS server provided
 * in options. callback will be called either with Error - cb(err) - or
 * with the recently instantiated client object: cb(null, ufds_client)
 */
function createUfdsClient(options, callback) {
    var ufds = new UFDS(options);

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
}


function createHTTPClients(options) {
    return {
        ca: new SDC.CA(options.ca),
        vmapi: new SDC.VMAPI(options.vmapi),
        napi: new SDC.NAPI(options.napi),
        fwapi: new SDC.FWAPI(options.fwapi),
        imgapi: new SDC.IMGAPI.createClient(options.imgapi),
        keyapi: new keyapi(options),
        cnapi: new SDC.CNAPI(options.cnapi),
        papi: SDC.PAPI(options.papi),
        mahi: (options.mahi) ? mahi.createClient(options.mahi) : null,
        cns: (options.cns) ? (new SDC.CNS(options.cns)) : null
    };
}


function createClients(options, callback) {
    assert.ok(options);
    assert.ok(options.ca);
    assert.ok(options.vmapi);
    assert.ok(options.napi);
    assert.ok(options.imgapi);
    assert.ok(options.fwapi);
    assert.ok(options.papi);
    assert.ok(options.ufds);
    assert.ok(options.ufds_master);

    var agent;
    if (options.cueballHttpAgent) {
        agent = new cueball.HttpAgent(options.cueballHttpAgent);
    }

    options.ufds.log   = options.log.child({ component: 'ufds' });
    options.ufds_master.log = options.log.child({ component: 'ufds_master' });
    options.ca.log     = options.log.child({ component: 'ca' });
    options.vmapi.log  = options.log.child({ component: 'vmapi' });
    options.napi.log   = options.log.child({ component: 'napi' });
    options.imgapi.log = options.log.child({ component: 'imgapi' });
    options.papi.log   = options.log.child({ component: 'papi' });
    options.fwapi.log  = options.log.child({ component: 'fwapi' });
    options.cnapi.log  = options.log.child({ component: 'cnapi' });

    options.fwapi.agent = agent;
    options.cnapi.agent = agent;
    options.papi.agent = agent;
    options.napi.agent = agent;
    options.vmapi.agent = agent;
    options.imgapi.agent = agent;

    if (options.mahi) {
        options.mahi.log = options.log.child({ component: 'mahi' });
        options.mahi.typeTable = apertureConfig.typeTable;
        options.mahi.agent = agent;
    }

    if (options.cns) {
        options.cns.log = options.log.child({ component: 'cns' });
        options.cns.agent = agent;
    }

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
                return callback(null, clients);
            });
        });
    }
}


/**
 * Load enabled pre|post provision plugins
 *
 * @param {Array} where each member is an {Object} representing a plugin config
 * @param {Array} ufdsPlugins is the same but coming from UFDS instead of
 *      the config file.
 * @returns {Object} with first member being preProvision methods to call, and
 *          second member postProvision
 */

function loadPlugins(plugins, ufdsPlugins, log) {
    assert.ok(plugins);
    // Load enabled pre|post provision plugins:
    var preProvision = [];
    var postProvision = [];

    // Plugins can be defined into Config file (plugins), UFDS (ufdsPlugins)
    // or both. UFDS will take precedence over the config file. Therefore, we
    // are gonna loop over ufdsPlugins and either append or override the
    // required plugins we obtained from the config file:
    ufdsPlugins.forEach(function (pl) {
        // If the plugin is already loaded from config, override with value
        // from UFDS
        plugins = plugins.map(function (plugin) {
            return ((plugin.name === pl.name) ? pl : plugin);
        });
    });

    // If the plugin is not loaded from config file, just add it:
    ufdsPlugins.forEach(function (pl) {
        if (!plugins.some(function (plugin) {
            return (plugin.name === pl.name);
        })) {
            plugins.push(pl);
        }
    });

    plugins.forEach(function (pluginInfo) {
        if (pluginInfo.enabled) {
            log.info('Loading plugin: %s', pluginInfo.name);

            var cfg = pluginInfo.config;
            var pPath = path.resolve(__dirname, '../plugins', pluginInfo.name);
            var plugin = require(pPath);

            if (plugin.preProvision) {
                preProvision.push(plugin.preProvision(cfg));
            }

            if (plugin.postProvision) {
                postProvision.push(plugin.postProvision(cfg));
            }
        }
    });

    return [preProvision, postProvision];
}


function loadPluginsCfg(ufds, log, cb) {
    function lookup() {
        ufds.search('ou=config, o=smartdc', {
            scope: 'one',
            filter: '(objectclass=config)'
        }, function (err, configs) {
            if (err) {
                log.error({err: err}, 'Cannot load plugins config. Retry...');
                return setTimeout(lookup, MORAY_POLL);
            }

            return cb(null, configs);
        });
    }

    lookup();
}


// --- API

module.exports = {

    createServer: function (config, callback) {

        var log = config.log;
        var globalAgentInterval;
        var server;
        var machineThrottle;

        config.name = 'Joyent Triton ' + version();
        config.version = ['8.0.0', '7.3.0', '7.2.0', '7.1.0', '7.0.0'];
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

        if (config.dc_maint_eta) {
            var d = new Date(config.dc_maint_eta);
            if (d.toString() !== 'Invalid Date') {
                config.dcMaintUtcEta = d.toUTCString();
            }
        }

        var kangOpts = cueball.poolMonitor.toKangOptions();
        kangOpts.port = config.port + 1010;
        /*
         * Note that we can't use kang.knStartServer here, as kang's restify
         * version does not match ours and the two will clobber each other.
         */
        var kangServer = restify.createServer({ serverName: 'Kang' });
        kangServer.get(new RegExp('.*'), kang.knRestifyHandler(kangOpts));
        kangServer.listen(kangOpts.port, '127.0.0.1', function () {
            log.info('cueball kang monitor started on port %d', kangOpts.port);
        });

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

            loadPluginsCfg(clients.ufds, log, function (pErr, pluginsCfg) {
                if (pErr) {
                    throw pErr;
                }

                pluginsCfg = pluginsCfg.map(translatePlugin);

                var plugins =  [];
                if (typeof (config.plugins) !== 'undefined' &&
                        Array.isArray(config.plugins)) {
                    plugins = loadPlugins(config.plugins, pluginsCfg, log);
                }

                server = restify.createServer(config);

                server.use(restify.acceptParser(server.acceptable));
                server.use(authorizationParser());
                server.use(restify.dateParser());
                server.use(restify.queryParser());
                server.use(restify.requestLogger());
                server.use(restify.bodyParser({
                    overrideParams: true,
                    mapParams: true,
                    maxBodySize: 100000
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
                    req.config.apertureConfig = apertureConfig;
                    req.sdc = clients;
                    return next();
                });

                // Account management feature, added at version 7.2.0,
                // requires both, the proper req.version and a configured
                // mahi instance. Additionally, it'll require the feature
                // added to bleeding_edge_features until it's out of beta:
                server.use(function accountMgmt(req, res, next) {
                    var v = req.getVersion();
                    if (req.sdc.mahi &&
                        (semver.satisfies('7.2.0', v) ||
                        semver.ltr('7.2.0', v))) {
                        req.accountMgmt = true;
                    }
                    return next();
                });

                // Run authentication and authorization before everything else
                server.use(auth.signatureAuth);
                server.use(auth.tokenAuth);
                server.use(auth.assertAuthenticated);
                server.use(auth.loadAccount);
                if (config.account_allowed_dcs) {
                    server.use(auth.authnAllowedDcs);
                }

                server.use(resources.resourceName);

                server.use(datasets.loadDatasets);
                server.use(packages.loadPackages);
                server.use(networks.loadNetworks);
                server.use(machines.loadMachine);

                server.use(resources.loadResource);

                // req.routename will be used to GRANT/DENY access using
                // policies rules. It must be called before auth.authorize.
                server.use(function reqRoutename(req, res, next) {
                    var resourceTagRoutes = [
                        'replaceaccountroletags',
                        'replaceresourcesroletags',
                        'replaceanalyticsresourcesroletags',
                        'replaceuserkeysresourcesroletags',
                        'replaceresourceroletags',
                        'replacemachineroletags',
                        'replaceanalyticsresourceroletags',
                        'replaceuserkeysresourceroletags'
                    ];

                    if (req.route.name !== 'updatemachine') {
                        if (resourceTagRoutes.indexOf(req.route.name) !== -1) {
                            req.routename = 'setroletags';
                        } else {
                            req.routename = req.route.name;
                        }
                    } else {
                        switch (req.params.action) {
                        case 'enable_firewall':
                            req.routename = 'enablemachinefirewall';
                            break;
                        case 'disable_firewall':
                            req.routename = 'disablemachinefirewall';
                            break;
                        default:
                            req.routename = req.params.action + 'machine';
                            break;
                        }
                    }
                    return next();
                });

                server.use(auth.authorize);

                server.use(function readOnlyMode(req, res, next) {
                    if ((req.method === 'PUT' ||
                        req.method === 'POST' ||
                        req.method === 'DELETE') &&
                        typeof (req.config.read_only) !== 'undefined' &&
                        req.config.read_only === true) {
                        if (req.config.dcMaintUtcEta) {
                            res.setHeader('Retry-After',
                                    req.config.dcMaintUtcEta);
                        }
                        var msg = req.config.dc_maint_message ||
                            'This Triton data center is being upgraded';

                        return next(new restify.ServiceUnavailableError(msg));
                    }

                    return next();
                });

                // Save Context for Machines Audit:
                server.use(function saveContext(req, res, next) {
                    if (!/\/machines/.test(req.getUrl().pathname)) {
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
                        req._auditCtx.keyId =
                            req.authorization.signature.keyId;
                    }

                    return next();
                });

                // Now mount all the API handlers. Images, packages and
                // networks are first:
                datasets.mount(server,
                        userThrottle(config, 'datasets'), config);
                packages.mount(server, userThrottle(config, 'packages'));
                networks.mount(server, userThrottle(config, 'networks'));

                // Wait for datasets and packages to mount everything else:
                account.mount(server, userThrottle(config, 'account'));
                datacenters.mount(server, userThrottle(config, 'datacenter'));
                services.mount(server, userThrottle(config, 'services'));
                keys.mount(server, userThrottle(config, 'keys'), config);

                machineThrottle = userThrottle(config, 'machines');
                // Make sure we pass the pre|post provision hooks
                // from the plugins
                machines.mount(server, machineThrottle, plugins[0], plugins[1]);
                metadata.mount(server, machineThrottle);
                snapshots.mount(server, machineThrottle);
                tags.mount(server, machineThrottle);
                audit.mount(server, machineThrottle);
                rules.mount(server, machineThrottle);

                analytics.mount(server, userThrottle(config, 'analytics'));
                users.mount(server, userThrottle(config, 'users'), config);
                policies.mount(server, userThrottle(config, 'policies'),
                        config);
                roles.mount(server, userThrottle(config, 'roles'), config);
                resources.mount(server, userThrottle(config, 'resources'),
                        config);
                nics.mount(server, userThrottle(config, 'nics'));
                mod_config.mount(server, userThrottle(config, 'config'));

                server.on('after', auditLogger({
                    log: log.child({component: 'audit'})
                }));

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

                    kangServer.close();

                    clients.vmapi.close();
                    clients.napi.close();
                    clients.fwapi.close();
                    clients.imgapi.close();
                    clients.ca.close();
                    clients.papi.close();
                    clients.cnapi.close();

                    if (clients.mahi) {
                        clients.mahi.close();
                    }

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
                    var e = new restify.InternalError('Internal Error');
                    req.log.error(err, 'unexpected error');
                    res.send(e);
                });

                server._clients = clients;
                return callback(null, server);
            });
        });
    }
};
