/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2025 Joyent, Inc.
 */

var assert = require('assert-plus');
var restify = require('restify');
var util = require('util');
var watershed = require('watershed');
var mooremachine = require('mooremachine');
var net = require('net');

var errors = require('../errors');
var shed = new watershed.Watershed();

var MachineHasNoConsoleError = errors.MachineHasNoConsoleError;
var MachineStoppedError = errors.MachineStoppedError;
var UpgradeRequiredError = errors.UpgradeRequiredError;

function mount(server, before, pre) {
    assert.object(server, 'server');
    assert.ok(before, 'before');
    assert.optionalArrayOfFunc(pre, 'pre');

    pre = pre || [];

    server.get({
        path: '/:account/machines/:machine/console',
        name: 'ConnectMachineConsole',
        version: [ '9.0.0' ]
    }, before, connectConsole);

    return server;
}

function connectConsole(req, res, next) {
    var vm = req.machine;

    // Most brands support console access:
    // - KVM/Bhyve: serial console
    // - Joyent/LX: zone console
    // MachineHasNoConsoleError is available for future brand restrictions.
    if (vm.state !== 'running') {
        next(new MachineStoppedError());
        return;
    }
    if (!res.claimUpgrade) {
        var msg = 'Console connect endpoint is a websocket and must be upgraded';
        next(new UpgradeRequiredError(msg));
        return;
    }

    /*
     * Since cloudapi still runs with restify request domains enabled, we need
     * to exit that domain here if we want any errors in the Console FSM to be
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

    var fsm = new ConsoleConnectionFSM(req, res, next);
    fsm.start();

    if (reqdom && reqdom.domain) {
        reqdom.enter();
    }
}


function ConsoleConnectionFSM(req, res, next) {
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
    this.type = undefined;

    mooremachine.FSM.call(this, 'init');
}

util.inherits(ConsoleConnectionFSM, mooremachine.FSM);

ConsoleConnectionFSM.prototype.state_init = function state_init(S) {
    S.on(this, 'startAsserted', function handleStarted() {
        S.gotoState('upgrade');
    });
};

ConsoleConnectionFSM.prototype.state_reject = function state_rejectsock() {
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

ConsoleConnectionFSM.prototype.state_upgrade = function state_upgrade(S) {
    // Initialize logger early in case of errors during upgrade
    if (!this.log) {
        this.log = this.req.log.child({ component: 'ConsoleConnectionFSM' });
    }
    try {
        this.upgrade = this.res.claimUpgrade();
        /*
         * For console connections, we want low latency for interactive
         * terminal sessions. Disable Nagle's algorithm so that keystrokes
         * are sent immediately.
         */
        this.upgrade.socket.setNoDelay(true);

        this.ws = shed.accept(this.req, this.upgrade.socket, this.upgrade.head,
            false, ['binary', 'console']);
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

ConsoleConnectionFSM.prototype.state_getport = function state_getport(S) {
    var vm = this.req.machine;
    var uri = '/servers/' + vm.compute_node + '/vms/' + vm.id + '/console';
    var self = this;
    this.req.sdc.cnapi.get(uri, S.callback(function gotConsoleDetails(err, obj) {
        if (err) {
            self.log.error(err, 'failed to fetch VM console details from CNAPI');
            self.err = new restify.InternalServerError('Failed to retrieve ' +
                'console socket details');
            S.gotoState('error');
            return;
        }
        if (typeof (obj.host) !== 'string' || typeof (obj.port) !== 'number') {
            self.log.error({ obj: obj }, 'CNAPI returned invalid VM console obj');
            self.err = new restify.InternalServerError('Failed to retrieve ' +
                'console socket details');
            S.gotoState('error');
            return;
        }
        self.host = obj.host;
        self.port = obj.port;
        self.type = obj.type || 'unknown';
        self.log = self.log.child({
            consoleHost: obj.host,
            consolePort: obj.port,
            consoleType: obj.type
        });
        self.log.debug('cnapi returned address for console');
        S.gotoState('connect');
    }));
    S.on(this.ws, 'error', function onWsError(_err) {
        S.gotoState('error');
    });
};

ConsoleConnectionFSM.prototype.state_error = function state_error() {
    this.log.warn(this.err, 'console connection exited with error');
    if (this.ws) {
        try {
            this.ws.end(JSON.stringify({ type: 'error', error: this.err }));
        } catch (_ex) {
            this.ws.destroy();
            this.ws = null;
        }
    }
    if (this.socket) {
        this.socket.destroy();
        this.socket = null;
    }
};

ConsoleConnectionFSM.prototype.state_connect = function state_connect(S) {
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
        self.log.error(err, 'failed to connect to console endpoint');
        self.err = new restify.InternalServerError('Failed to connect to ' +
                'console server');
        S.gotoState('error');
    });
    S.timeout(5000, function connectTimeout() {
        self.log.error('timeout while connecting to console endpoint');
        self.err = new restify.InternalServerError('Timeout while connecting ' +
            'to console server');
        S.gotoState('error');
    });
};

ConsoleConnectionFSM.prototype.state_connected = function state_connected(S) {
    var self = this;
    this.socket.setNoDelay(true);

    S.on(this.ws, 'error', function consoleWsError(err) {
        self.log.error(err, 'error on websocket connection to client');
        self.err = err;
        S.gotoState('error');
    });
    S.on(this.ws, 'end', function consoleWsEnd() {
        S.gotoState('ws_ended');
    });
    S.on(this.ws, 'connectionReset', function consoleWsReset() {
        S.gotoState('ws_ended');
    });

    S.on(this.socket, 'end', function consoleSockEnd() {
        S.gotoState('sock_ended');
    });
    S.on(this.socket, 'error', function consoleSockErr(err) {
        self.log.error(err, 'error on console connection');
        S.gotoState('error');
    });

    S.on(this.ws, 'binary', function consoleWsGotData(buf) {
        self.socket.write(buf);
    });
    S.on(this.socket, 'readable', function consoleSockGotData() {
        var buf;
        while ((buf = self.socket.read()) !== null) {
            self.ws.send(buf);
        }
    });
};

ConsoleConnectionFSM.prototype.state_ws_ended = function state_ws_ended(S) {
    S.on(this.socket, 'close', function consoleSockClose() {
        S.gotoState('closed');
    });
    S.timeout(5000, function consoleSockCloseTimeout() {
        S.gotoState('error');
    });
    this.socket.end();
    this.socket = null;
};

ConsoleConnectionFSM.prototype.state_sock_ended = function state_sock_ended(S) {
    this.ws.end('Remote connection closed');
    this.ws = null;
    S.gotoState('closed');
};

ConsoleConnectionFSM.prototype.state_closed = function state_closed() {
    if (this.socket) {
        this.socket.destroy();
    }
    this.socket = null;
    if (this.ws) {
        this.ws.destroy();
    }
    this.ws = null;
};

ConsoleConnectionFSM.prototype.start = function start() {
    this.log = this.req.log.child({ component: 'ConsoleConnectionFSM' });

    this.emit('startAsserted');
};

module.exports = {
    mount: mount
};
