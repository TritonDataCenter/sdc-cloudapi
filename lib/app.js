// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var fs = require('fs');
var http = require('http');
var https = require('https');
var util = require('util');

var Logger = require('bunyan');
var restify = require('restify');
var SDC = require('sdc-clients');

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



///--- Globals

var HTML_FMT = '<html><head /><body><p>%s</p></body></html>\n';
var VERSION = false;
var sprintf = util.format;

var userThrottle = throttle.getUserThrottle;
var ipThrottle = throttle.getIpThrottle;



///--- Internal functions

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

        if (config.certificate && config.key && !config.port)
            config.port = 443;

        if (!config.port)
            config.port = 80;

    } catch (e1) {
        console.error('Unable to parse %s: %s', file, e1.message);
        process.exit(1);
    }

    if (options.port)
        config.port = options.port;

    try {
        if (config.certificate)
            config.certificate = fs.readFileSync(config.certificate, 'utf8');
    } catch (e2) {
        console.error('Unable to load %s: %s', config.certificate, e2.message);
        process.exit(1);
    }

    try {
        if (config.key)
            config.key = fs.readFileSync(config.key, 'utf8');
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


function createClients(options) {
    assert.ok(options);
    assert.ok(options.ca);
    assert.ok(options.vmapi);
    assert.ok(options.imgapi);
    // assert.ok(options.mapi);
    assert.ok(options.ufds);

    options.ca.log = options.log;
    options.vmapi.log = options.log;
    options.imgapi.log = options.log;
    // options.mapi.log = options.log;
    // options.ufds.log = options.log;

    var ufds = new SDC.UFDS(options.ufds);
    ufds.on('error', function (err) {
        options.log.error({err: err}, 'UFDS error');
    });

    return {
        ca: new SDC.CA(options.ca),
        // mapi: new SDC.MAPI(options.mapi),
        vmapi: new SDC.VMAPI(options.vmapi),
        imgapi: new SDC.IMGAPI(options.imgapi),
        ufds: new SDC.UFDS(options.ufds)
    };
}



///--- API

module.exports = {

    createServer: function (options) {
        assert.argument('options', 'object', options);
        assert.argument('options.config', 'string', options.config);
        assert.argument('options.dtrace', 'object', options.dtrace);
        assert.argument('options.log', 'object', options.log);
        assert.argument('options.overrides', 'object', options.overrides);

        var config = configure(options.config, options.overrides, options.log),
            log = options.log;

        config.dtrace = options.dtrace;
        config.log = log;
        config.name = 'Joyent SmartDataCenter ' + version();
        config.version = [version(), '6.5.0'];
        config.formatters = {
            'text/html': function formatHTML(req, res, body) {
                if (typeof (body) === 'string')
                    return body;

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
                if (typeof (body) === 'string')
                    return body;

                return '';
            },

            'image/png': function formatPNG(req, res, body) {
                return body;
            }
        };
        var clients = createClients(config);

        var server = restify.createServer(config);

        server.use(restify.acceptParser(server.acceptable));
        server.use(restify.authorizationParser());
        server.use(restify.dateParser());
        server.use(restify.queryParser());
        server.use(restify.bodyParser());

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
            if (req.method === 'HEAD' && /6\.5/.test(req.version))
                res.contentLength = 0;

            return next();
        });

        // Now mount all the API handlers
        account.mount(server, userThrottle(config, 'account'));
        datacenters.mount(server, userThrottle(config, 'datacenter'));
        keys.mount(server, userThrottle(config, 'keys'));

        server.use(datasets.load);
        datasets.mount(server, userThrottle(config, 'datasets'));

        server.use(packages.load);
        packages.mount(server, userThrottle(config, 'packages'));

        var machineThrottle = userThrottle(config, 'machines');
        machines.mount(server, machineThrottle);
        metadata.mount(server, machineThrottle);
        snapshots.mount(server, machineThrottle);
        tags.mount(server, machineThrottle);

        analytics.mount(server, userThrottle(config, 'analytics'));

        // Register an audit logger
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

        // Closure to wrap up the port setting
        server.start = function start(callback) {
            return server.listen(config.port, callback);
        };

        // Setup a logger on HTTP Agent queueing
        setInterval(function () {
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
        });

        return server;
    }


};
