/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var fs = require('fs');
var http = require('http');
var https = require('https');

var DEFAULT_CFG = __dirname + '/../etc/cloudapi.cfg';

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
        assert.optionalNumber(options.overrides.port);

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
    options, callback) {
    assert.object(ufdsClient, 'ufdsClient');
    assert.object(account, 'account');
    assert.string(datacenterName, 'datacenterName');
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');
    assert.func(callback, 'callback');

    var accountUuid = account.uuid;
    var log = options.log;

    log.info({ accountUuid: accountUuid, dcName: datacenterName },
        'Getting user config');

    ufdsClient.getDcLocalConfig(accountUuid, datacenterName,
            function _afterConfGet(err, conf) {
        if (err) {
            return callback(err);
        }

        log.info({
            accountUuid: accountUuid, dcName: datacenterName, config: conf
        }, 'Got user config');
        return callback(null, conf);
    });
}

module.exports = {
    configure: configure,
    getAccountDcConfigFromUFDS: getAccountDcConfigFromUFDS
};