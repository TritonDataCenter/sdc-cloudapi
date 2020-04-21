/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var assert = require('assert-plus');
var jsprim = require('jsprim');
var restify = require('restify');
var schemas = require('joyent-schemas').cloudapi;
var util = require('util');
var vasync = require('vasync');
var watershed = require('watershed');
var mooremachine = require('mooremachine');
var net = require('net');

var shed = new watershed.Watershed();

function mount(server, before, pre) {
    assert.object(server, 'server');
    assert.ok(before, 'before');
    assert.optionalArrayOfFunc(pre, 'pre');

    pre = pre || [];

    server.get({
        path: '/:account/machines/:machine/vnc',
        name: 'ConnectMachineVNC',
        version: [ '8.4.0' ]
    }, before, connectVNC);

    return server;
}

function connectVNC(req, res, next) {
    var vm = req.machine;
    if (vm.brand !== 'kvm' && vm.brand !== 'bhyve') {
        res.send(400, new restify.RestError({
            statusCode: 400,
            restCode: 'MachineHasNoVNC',
            message: 'Specified machine does not have a VNC console'
        }));
        next();
        return;
    }
    if (vm.state !== 'running') {
        res.send(400, new restify.RestError({
            statusCode: 400,
            restCode: 'MachineStopped',
            message: 'Specified machine is stopped and cannot be connected to'
        }));
        next();
        return;
    }
    if (!res.claimUpgrade) {
        res.send(400, new restify.RestError({
            statusCode: 400,
            restCode: 'UpgradeRequired',
            message: 'VNC connect endpoint is a websocket and must be Upgraded'
        }));
        next();
        return;
    }

    /*
     * Since cloudapi still runs with restify request domains enabled, we need
     * to exit that domain here if we want any errors in the VNC FSM to be
     * reported sensibly (since the request will end from restify's
     * perspective once we send the 101).
     *
     * This can be removed once domains and the uncaughtException handler are
     * turned off for cloudapi.
     */
    var reqdom = process.domain;

    if (reqdom && reqdom.domain) {
        reqdom.exit();
    }

    var fsm = new VNCConnectionFSM(req, res, next);
    fsm.start();

    if (reqdom && reqdom.domain) {
        reqdom.enter();
    }
}


function VNCConnectionFSM(req, res, next) {
    this.req = req;
    this.res = res;
    this.next = next;
    this.err = undefined;
    this.log = undefined;
    this.upgrade = undefined;
    this.ws = undefined;
    this.socket = undefined;
    this.host = undefined;
    this.port = undefined;

    mooremachine.FSM.call(this, 'init');
}

util.inherits(VNCConnectionFSM, mooremachine.FSM);

VNCConnectionFSM.prototype.state_init = function state_init(S) {
    S.on(this, 'startAsserted', function handleStarted() {
        S.gotoState('upgrade');
    });
};

VNCConnectionFSM.prototype.state_reject = function state_rejectsock(S) {
    var err = new restify.InternalServerError();
    var code = err.statusCode;
    var data = JSON.stringify(err.body);
    this.upgrade.socket.write('HTTP/1.1 ' + code + ' Upgrade Rejected\r\n' +
        'Connection: close\r\n' +
        'Content-Type: application/json\r\n' +
        'Content-Length: ' + data.length + '\r\n\r\n');
    this.upgrade.socket.end(data);
    this.next();
};

VNCConnectionFSM.prototype.state_upgrade = function state_upgrade(S) {
    try {
        this.upgrade = this.res.claimUpgrade();
        /*
         * Since VNC prefers low latency over high bandwidth, disable Nagle's
         * algorithm. This means that small data packets (e.g. mouse movements
         * or key presses) will be sent immediately instead of waiting for
         * further data.
         */
        this.upgrade.socket.setNoDelay(true);

        this.ws = shed.accept(this.req, this.upgrade.socket, this.upgrade.head,
            false, ['binary', 'rfb']);
    } catch (ex) {
        this.log.error(ex, 'websocket upgrade failed');
        S.gotoState('reject');
        return;
    }
    /*
     * From restify's perspective, the HTTP request ends here. We set the
     * statusCode so that the audit logs show that we upgraded to websockets.
     */
    this.res.statusCode = 101;
    this.next();

    /* Now we continue on to use the websocket. */
    S.gotoState('getport');
};

VNCConnectionFSM.prototype.state_getport = function state_getport(S) {
    var vm = this.req.machine;
    var uri = '/servers/' + vm.compute_node + '/vms/' + vm.id + '/vnc';
    var self = this;
    this.req.sdc.cnapi.get(uri, S.callback(function gotVNCDetails(err, obj) {
        if (err) {
            self.log.error(err, 'failed to fetch VM VNC details from CNAPI');
            self.err = new restify.InternalServerError('Failed to retrieve ' +
                'VNC socket details');
            S.gotoState('error');
            return;
        }
        if (typeof (obj.host) !== 'string' || typeof (obj.port) !== 'number') {
            self.log.error({ obj: obj }, 'CNAPI returned invalid VM VNC obj');
            self.err = new restify.InternalServerError('Failed to retrieve ' +
                'VNC socket details');
            S.gotoState('error');
            return;
        }
        self.host = obj.host;
        self.port = obj.port;
        self.log = self.log.child({ vncHost: obj.host, vncPort: obj.port });
        self.log.debug('cnapi returned address for vnc');
        S.gotoState('connect');
    }));
    S.on(this.ws, 'error', function onWsError(err) {
        S.gotoState('error');
    });
};

VNCConnectionFSM.prototype.state_error = function state_error(S) {
    this.log.warn(this.err, 'vnc connection exited with error');
    if (this.ws) {
        try {
            this.ws.end(JSON.stringify({ type: 'error', error: this.err }));
        } catch (ex) {
            this.ws.destroy();
            this.ws = null;
        }
    }
    if (this.socket) {
        this.socket.destroy();
        this.socket = null;
    }
};

VNCConnectionFSM.prototype.state_connect = function state_connect(S) {
    var self = this;

    S.on(this.ws, 'error', function connectWsError(err) {
        self.err = err;
        S.gotoState('error');
    });
    S.on(this.ws, 'end', function connectWsEnd() {
        S.gotoState('ws_ended');
    });

    this.socket = net.createConnection({
        allowHalfOpen: true,
        host: this.host,
        port: this.port
    });

    S.on(this.socket, 'connect', function connected() {
        S.gotoState('connected');
    });
    S.on(this.socket, 'error', function connectSockErr(err) {
        self.log.error(err, 'failed to connect to VNC endpoint');
        self.err = new restify.InternalServerError('Failed to connect to ' +
                'VNC server');
        S.gotoState('error');
    });
    S.timeout(5000, function connectTimeout() {
        self.log.error('timeout while connecting to VNC endpoint');
        self.err = new restify.InternalServerError('Timeout while connecting ' +
            'to VNC server');
        S.gotoState('error');
    });
};

VNCConnectionFSM.prototype.state_connected = function state_connected(S) {
    var self = this;
    this.socket.setNoDelay(true);

    S.on(this.ws, 'error', function vncWsError(err) {
        self.log.error(err, 'error on websocket connection to client');
        self.err = err;
        S.gotoState('error');
    });
    S.on(this.ws, 'end', function vncWsEnd() {
        S.gotoState('ws_ended');
    });
    S.on(this.ws, 'connectionReset', function vncWsReset() {
        S.gotoState('ws_ended');
    });

    S.on(this.socket, 'end', function vncSockEnd() {
        S.gotoState('sock_ended');
    });
    S.on(this.socket, 'error', function vncSockErr(err) {
        self.log.error(err, 'error on VNC connection');
        S.gotoState('error');
    });

    S.on(this.ws, 'binary', function vncWsGotData(buf) {
        self.socket.write(buf);
    });
    S.on(this.socket, 'readable', function vncSockGotData() {
        var buf;
        while ((buf = self.socket.read()) !== null) {
            self.ws.send(buf);
        }
    });
};

VNCConnectionFSM.prototype.state_ws_ended = function state_ws_ended(S) {
    S.on(this.socket, 'close', function vncSockClose() {
        S.gotoState('closed');
    });
    S.timeout(5000, function vncSockCloseTimeout() {
        S.gotoState('error');
    });
    this.socket.end();
    this.socket = null;
};

VNCConnectionFSM.prototype.state_sock_ended = function state_sock_ended(S) {
    this.ws.end('Remote connection closed');
    this.ws = null;
    S.gotoState('closed');
};

VNCConnectionFSM.prototype.state_closed = function state_closed(S) {
    if (this.socket) {
        this.socket.destroy();
    }
    this.socket = null;
    if (this.ws) {
        this.ws.destroy();
    }
    this.ws = null;
};

VNCConnectionFSM.prototype.start = function start() {
    this.log = this.req.log.child({ component: 'VNCConnectionFSM' });

    this.emit('startAsserted');
};

module.exports = {
    mount: mount
};
