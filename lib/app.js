// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var fs = require('fs');
var http = require('http');
var https = require('https');
var util = require('util');

var Logger = require('bunyan');
var restify = require('restify');
var SDC = require('sdc-clients');
var imgapi = require('sdc-clients/lib/imgapi');
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


function configure(file, options, log) {
    assert.ok(file);
    var config;

    try {
        config = JSON.parse(fs.readFileSync(file, 'utf8'));

        if (config.certificate && config.key && !config.port) {
            config.port = 443;
        }

        if (!config.port) {
            config.port = 80;
        }

    } catch (e1) {
        console.error('Unable to parse %s: %s', file, e1.message);
        process.exit(1);
    }

    if (options.port) {
        config.port = options.port;
    }

    try {
        if (config.certificate) {
            config.certificate = fs.readFileSync(config.certificate, 'utf8');
        }
    } catch (e2) {
        console.error('Unable to load %s: %s', config.certificate, e2.message);
        process.exit(1);
    }

    try {
        if (config.key) {
            config.key = fs.readFileSync(config.key, 'utf8');
        }
    } catch (e3) {
        console.error('Unable to load %s: %s', config.certificate, e3.message);
        process.exit(1);
    }

    if (typeof (config.maxHttpSockets) === 'number') {
        log.info('Tuning max sockets to %d', config.maxHttpSockets);
        http.globalAgent.maxSockets = config.maxHttpSockets;
        https.globalAgent.maxSockets = config.maxHttpSockets;
    }

    return config;
}


function createClients(options, callback) {
    assert.ok(options);
    assert.ok(options.ca);
    assert.ok(options.vmapi);
    assert.ok(options.napi);
    assert.ok(options.imgapi);
    assert.ok(options.ufds);
    assert.ok(options.keyapi);

    options.ca.log = options.log;
    options.vmapi.log = options.log;
    options.napi.log = options.log;
    options.imgapi.log = options.log;

    var ufds = new SDC.UFDS(options.ufds);

    ufds.on('error', function (err) {
        options.log.error({err: err}, 'UFDS error');
        return callback(err);
    });

    return ufds.on('ready', function () {
        return callback(null, {
            ca: new SDC.CA(options.ca),
            vmapi: new SDC.VMAPI(options.vmapi),
            napi: new SDC.NAPI(options.napi),
            imgapi: imgapi.createClient(options.imgapi),
            ufds: ufds,
            keyapi: options.keyapi,
            pkg: new SDC.Package(ufds)
        });
    });
}


/**
 * Load enabled pre|post provision plugins
 *
 * @param {Array} where each member is an {Object} representing a plugin config
 * @returns {Object} with first member being preProvision methods to call, and
 *          second member postProvision
 */

function loadPlugins(plugins) {
    assert.ok(plugins);
    // Load enabled pre|post provision plugins:
    var p = {};
    var cfg = {};
    var preProvision = [];
    var postProvision = [];

    plugins.forEach(function (plugin) {
        if (plugin.enabled) {
            cfg[plugin.name] = plugin.config;
            p[plugin.name] = require(util.format('./plugins/%s', plugin.name));
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

    createServer: function (options, callback) {
        assert.argument('options', 'object', options);
        assert.argument('options.config', 'string', options.config);
        assert.argument('options.log', 'object', options.log);
        assert.argument('options.overrides', 'object', options.overrides);

        var config = configure(options.config, options.overrides, options.log),
            log = options.log,
            globalAgentInterval,
            server,
            machineThrottle;

        config.log = log;
        config.name = 'Joyent SmartDataCenter ' + version();
        config.version = [version(), '6.5.0'];
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

            server = restify.createServer(config);

            server.use(restify.acceptParser(server.acceptable));
            server.use(restify.authorizationParser());
            server.use(restify.dateParser());
            server.use(restify.queryParser());
            server.use(restify.bodyParser({
                overrideParams: true,
                mapParams: true
            }));
            server.use(restify.fullResponse());

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
            server.use(auth.assertAuthenticated);
            server.use(auth.loadAccount);
            server.use(auth.authorize);

            server.use(function sendZeroContentLengthon65(req, res, next) {
                if (req.method === 'HEAD' && /6\.5/.test(req.getVersion())) {
                    res.contentLength = 0;
                }

                return next();
            });

            // Now mount all the API handlers
            server.use(datasets.load);
            datasets.mount(server, userThrottle(config, 'datasets'));

            server.use(packages.load);
            packages.mount(server, userThrottle(config, 'packages'));

            server.use(networks.load);

            var plugins =  [];
            if (typeof (config.plugins) !== 'undefined' &&
                    Array.isArray(config.plugins)) {
                plugins = loadPlugins(config.plugins);
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

            analytics.mount(server, userThrottle(config, 'analytics'));

            // Register an audit logger (avoid it while testing):
            if (typeof (options.test) === 'undefined') {
                server.on('after', restify.auditLogger({
                    log: new Logger({
                        name: 'audit',
                        streams: [
                            {
                                level: 'info',
                                stream: process.stdout
                            }
                        ]
                    })
                }));
            }


            // Closure to wrap up the port setting
            server.start = function start(cb) {
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
                });
            });

            return callback(server);

        });


    }


};
