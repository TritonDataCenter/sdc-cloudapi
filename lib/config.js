/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Endpoints for managing account configuration
 */

var assert = require('assert-plus');
var fs = require('fs');
var http = require('http');
var https = require('https');

var DEFAULT_CFG = __dirname + '/../etc/cloudapi.cfg';

/**
 * Translate the UFDS representation of a default network into a
 * cloudapi-friendly format
 */
function translateUfdsConf(conf) {
    return {
        default_network: conf.defaultnetwork
    };
}

function configure(options) {
    assert.optionalObject(options, 'options');
    options = options || {};

    assert.optionalObject(options.overrides, 'options.overrides');
    assert.optionalString(options.configFilePath, 'options.configFilePath');
    assert.optionalObject(options.log, 'log');

    var config;
    var log = options.log;
    var configFilePath = options.configFilePath || DEFAULT_CFG;

    try {
        config = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));

        if (config.certificate && config.key && !config.port) {
            config.port = 443;
        }

        if (!config.port) {
            config.port = 80;
        }

    } catch (e1) {
        console.error('Unable to parse %s: %s', configFilePath, e1.message);
        process.exit(1);
    }

    if (options.overrides) {
        assert.optionalNumber(options.overrides.port, 'options.overrides.port');

        if (options.overrides.port !== undefined) {
            config.port = options.overrides.port;
        }
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

function getAccountDcConfigFromUFDS(ufdsClient, account, datacenterName,
    options, cb) {
    assert.object(ufdsClient, 'ufdsClient');
    assert.object(account, 'account');
    assert.string(datacenterName, 'datacenterName');
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');
    assert.func(cb, 'cb');

    var accountUuid = account.uuid;
    var log = options.log;

    log.info({ accountUuid: accountUuid, dcName: datacenterName },
        'Getting user config');

    ufdsClient.getDcLocalConfig(accountUuid, datacenterName,
            function _afterConfGet(err, conf) {
        if (err) {
            if (err.name !== 'ResourceNotFoundError') {
                cb(err);
                return;
            } else {
                conf = {}; // treat an empty object as default
            }
        }

        cb(null, conf);
    }, true); // disable caching
    /*
     * Fetching the config is an uncommon operation, and caching the value
     * causes inconsistencies since cloudapi usually operates with multiple
     * processes (thus multiple caches, where invalidations and updates in one
     * process don't occur in the others). Disabling caching ensures that
     * clients get a consistent view, and prevents problems in other parts of
     * cloudapi's code that uses values in the config.
     */
}

module.exports = {
    configure: configure,
    getAccountDcConfigFromUFDS: getAccountDcConfigFromUFDS,
    translateUfdsConf: translateUfdsConf
};