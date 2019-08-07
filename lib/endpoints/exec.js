/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Author: Alex Wilson <alex@uq.edu.au>
 * Copyright 2019, The University of Queensland
 */

var assert = require('assert-plus');
var jsprim = require('jsprim');
var restify = require('restify');
var schemas = require('joyent-schemas').cloudapi;
var util = require('util');
var vasync = require('vasync');
var net = require('net');

function mount(server, before, pre) {
    assert.object(server, 'server');
    assert.ok(before, 'before');
    assert.optionalArrayOfFunc(pre, 'pre');

    pre = pre || [];

    server.post({
        path: '/:account/machines/:machine/exec',
        name: 'ExecMachineCommand',
        version: [ '8.4.0' ]
    }, before, execCommand);

    return server;
}

function execCommand(req, res, next) {
    var vm = req.machine;

    if (vm.brand !== 'joyent' && vm.brand !== 'joyent-minimal' &&
        vm.brand !== 'lx') {
        res.send(400, new restify.RestError({
            statusCode: 400,
            restCode: 'MachineIsHVM',
            message: 'Specified machine is an HVM and cannot execute commands'
        }));
        next();
        return;
    }

    if (vm.state !== 'running') {
        res.send(400, new restify.RestError({
            statusCode: 400,
            restCode: 'MachineStopped',
            message: 'Only running machines can execute commands'
        }));
        next();
        return;
    }

    if (!req.params.argv || !Array.isArray(req.params.argv)) {
        res.send(400, new restify.RestError({
            statusCode: 400,
            restCode: 'InvalidArgument',
            message: 'The "argv" parameter is required and must be an Array'
        }));
        next();
        return;
    }

    var params = {
        'command': {
            'Cmd': req.params.argv
        }
    };
    req.sdc.cnapi.dockerExec(vm.compute_node, vm.id, params,
        function afterDockerExec(err, info) {
            if (err) {
                req.log.error(err, 'failed to start exec job');
                res.send(500, new restify.InternalServerError('Failed to ' +
                    'execute command'));
                next();
                return;
            }

            req.log.debug({ info: info }, 'exec job got connection info');

            var data = '';
            var sock = net.createConnection({
                host: info.host,
                port: info.port
            });
            sock.on('connect', function () {
                res.header('content-type', 'application/x-json-stream');
                sock.pipe(res);
                sock.on('end', function () {
                    next();
                });
            });
            sock.on('error', function (err) {
                req.log.error(err, 'error from exec job socket');
                res.send(500, new restify.InternalServerError('Failed to ' +
                    'execute command'));
                next();
                return;
            });
    });
}

module.exports = {
    mount: mount
};