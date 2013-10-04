// Copyright 2012 Joyent, Inc.  All rights reserved.

var path = require('path');
var assert = require('assert');
var fs = require('fs');
var http = require('http');
var https = require('https');

var Logger = require('bunyan');
var nopt = require('nopt');
var restify = require('restify');

var bsyslog = require('bunyan-syslog');
var os = require('os');

var app = require('./lib').app;



///--- Globals

var DEFAULT_CFG = __dirname + '/etc/cloudapi.config.json';
var LOG;
var PARSED;


var opts = {
    'debug': Boolean,
    'file': String,
    'port': Number,
    'help': Boolean
};

var shortOpts = {
    'd': ['--debug'],
    'f': ['--file'],
    'p': ['--port'],
    'h': ['--help']
};



///--- Helpers

function setupLogger(config) {
    assert.ok(config.bunyan);
    var cfg_b = config.bunyan;


    var level = LOG.level();

    if (cfg_b.syslog) {
        assert.ok(cfg_b.syslog.facility);
        assert.ok(cfg_b.syslog.type);

        var facility = bsyslog.facility[cfg_b.syslog.facility];
        LOG = Logger.createLogger({
            name: 'CloudAPI',
            serializers: restify.bunyan.serializers,
            streams: [ {
                level: level,
                type: 'raw',
                stream: bsyslog.createBunyanStream({
                    name: 'CloudAPI',
                    facility: facility,
                    host: cfg_b.syslog.host,
                    port: cfg_b.syslog.port,
                    type: cfg_b.syslog.type
                })
            } ]
        });
    }

    if (cfg_b.level) {
        if (Logger.resolveLevel(cfg_b.level)) {
            LOG.level(cfg_b.level);
        }
    }
}

function usage(code, message) {
    var _opts = '';
    Object.keys(shortOpts).forEach(function (k) {
        var longOpt = shortOpts[k][0].replace('--', '');
        var type = opts[longOpt].name || 'string';
        if (type && type === 'boolean') {
            type = '';
        }
        type = type.toLowerCase();

        _opts += ' [--' + longOpt + ' ' + type + ']';
    });

    var msg = (message ? message + '\n' : '') +
        'usage: ' + path.basename(process.argv[1]) + _opts;

    process.stderr.write(msg + '\n');
    process.exit(code);
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

function run() {

    LOG = new Logger({
        level: (PARSED.debug ? 'trace' : 'info'),
        name: 'CloudAPI',
        stream: process.stderr,
        serializers: restify.bunyan.serializers
    });

    var options = {
        config: PARSED.file || DEFAULT_CFG,
        overrides: PARSED,
        log: LOG
    };

    var config = configure(options.config, options.overrides, options.log);

    setupLogger(config);

    config.log = LOG;

    return app.createServer(config, function (server) {
        server.start(function () {
            LOG.info('CloudAPI listening at %s', server.url);
        });

        return server;
    });
}

///--- Mainline

PARSED = nopt(opts, shortOpts, process.argv, 2);
if (PARSED.help) {
    usage(0);
}

// There we go!:
run();

// Increase/decrease loggers levels using SIGUSR2/SIGUSR1:
var sigyan = require('sigyan');
sigyan.add([LOG]);
