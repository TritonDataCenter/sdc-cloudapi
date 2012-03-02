// Copyright 2011 Joyent, Inc.  All rights reserved.
var assert = require('assert');
var crypto = require('crypto');

var Logger = require('bunyan');
var restify = require('restify');
var uuid = require('node-uuid');

var UFDS = require('sdc-clients').UFDS;



///--- Globals

var PASSWD = 'secret';



///--- Library

module.exports = {

    setup: function(callback) {
        assert.ok(callback);

        var user = 'a' + uuid().substr(0, 7) + '@joyent.com';
        var client = restify.createJsonClient({
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

        var ufds = new UFDS({
            url: (process.env.UFDS_URL || 'ldaps://10.99.99.21'),
            bindDN: 'cn=root',
            bindPassword: 'secret',
        });
        ufds.on('error', function(err) {
            return callback(err);
        });
        ufds.on('ready', function() {
            var entry = {
                login: client.testUser,
                email: client.testUser,
                userpassword: PASSWD
            };
            return ufds.addUser(entry, function(err) {
                if (err)
                    return callback(err);

                client.ufds = ufds;
                client.teardown = function teardown(callback) {
                    client.ufds.deleteUser(client.testUser, function(err) {
                        if (err) // blindly ignore
                            return callback(err);

                        ufds.close(function() {});
                        return callback(null);
                    });
                };

                return callback(null, client);
            })
        });
    },

    checkHeaders: function(t, headers) {
        assert.ok(t);

        t.ok(headers);
        t.ok(headers['access-control-allow-origin']);
        t.ok(headers['access-control-allow-methods']);
        t.ok(headers.date);
        t.ok(headers['x-request-id']);
        t.ok(headers['x-response-time'] >= 0);
        t.equal(headers.server, 'Joyent SmartDataCenter 7.0.0');
        t.equal(headers.connection, 'close');
        t.equal(headers['x-api-version'], '7.0.0');
    }

};
