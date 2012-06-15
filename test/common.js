// Copyright 2012 Joyent, Inc. All rights reserved.
var assert = require('assert');
var crypto = require('crypto');

var Logger = require('bunyan');
var restify = require('restify');
var uuid = require('node-uuid');

var UFDS = require('sdc-clients').UFDS;



// --- Globals

var PASSWD = 'secret';



// --- Library

module.exports = {

    setup: function (callback) {
        assert.ok(callback);

        var user = 'a' + uuid().substr(0, 7) + '@joyent.com',
            ufds,
            client = restify.createJsonClient({
            url: process.env.CLOUDAPI_URL || 'http://localhost:8080',
            version: '*',
            retryOptions: {
                retry: 0
            },
            log: new Logger({
                level: process.env.LOG_LEVEL || 'info',
                name: 'cloudapi_unit_test',
                stream: process.stderr,
                serializers: {
                    err: Logger.stdSerializers.err,
                    req: Logger.stdSerializers.req,
                    res: restify.bunyan.serializers.response
                }
            })
        });
        client.basicAuth(user, PASSWD);
        client.testUser = user;

        ufds = new UFDS({
            url: (process.env.UFDS_URL || 'ldaps://10.99.99.13'),
            bindDN: 'cn=root',
            bindPassword: 'secret'
        });
        ufds.on('error', function (err) {
            return callback(err);
        });
        ufds.on('ready', function () {
            var entry = {
                login: client.testUser,
                email: client.testUser,
                userpassword: PASSWD
            };
            return ufds.addUser(entry, function (err) {
                if (err) {
                    return callback(err);
                }

                client.ufds = ufds;
                client.teardown = function teardown(cb) {
                    client.ufds.deleteUser(client.testUser, function (err2) {
                        if (err2) {
                            // blindly ignore
                            return cb(err2);
                        }

                        ufds.close(function () {});
                        return cb(null);
                    });
                };

                return callback(null, client);
            });
        });
    },

    checkHeaders: function (t, headers) {
        assert.ok(t);

        t.ok(headers, 'headers ok');
        t.ok(headers['access-control-allow-origin'], 'headers allow-origin');
        t.ok(headers['access-control-allow-methods'], 'headers allow-methods');
        t.ok(headers.date, 'headers date');
        t.ok(headers['x-request-id'], 'headers x-request-id');
        t.ok(headers['x-response-time'] >= 0, 'headers response time');
        t.equal(headers.server, 'Joyent SmartDataCenter 7.0.0',
                'headers server');
        t.equal(headers.connection, 'Keep-Alive', 'headers keep alive');
        t.equal(headers['x-api-version'], '7.0.0', 'headers x-api-version');
    }

};
