/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2026 Edgecast Cloud LLC.
 */

/*
 * ConnectMachineConsole: a websocket relay to an instance's serial or zone
 * console.
 *
 * Before accepting the websocket we get a single-use ticket from CNAPI
 * (VmConsole), connect to vmadmd on the compute node, send the token and wait
 * for "OK". Every failure up to that point is returned as a normal HTTP error.
 * Once the websocket is accepted, binary frames are relayed in both
 * directions.
 */

var assert = require('assert-plus');
var net = require('net');
var restify = require('restify');
var watershed = require('watershed');

var errors = require('../errors');

var shed = new watershed.Watershed();

var CONSOLE_BRANDS = ['bhyve', 'joyent', 'joyent-minimal', 'kvm', 'lx'];
var TOKEN_RE = /^[0-9a-f]{64}$/;
var MAX_LINE = 256;

var DEFAULTS = {
    // Covers the TCP connect, token exchange and zoneadmd handshake.
    connectTimeout: 10 * 1000,
    closeTimeout: 5 * 1000,
    // Stop reading the console while this much is queued for the client.
    clientHighWater: 256 * 1024,
    // Drop the session if the client queues this much for the console.
    backendMaxBacklog: 1024 * 1024
};


/*
 * Reads one '\n' terminated line from sock without switching it to flowing
 * mode, so data after the line stays buffered. Calls cb(err, line, rest).
 */
function readLine(sock, cb) {
    var bufs = [];
    var finished = false;
    var len = 0;

    function finish(err, line, rest) {
        if (finished) {
            return;
        }
        finished = true;
        sock.removeListener('readable', onReadable);
        sock.removeListener('end', onEnd);
        cb(err, line, rest);
    }

    function onReadable() {
        var buf;
        var chunk;
        var idx;

        while (!finished && (chunk = sock.read()) !== null) {
            bufs.push(chunk);
            len += chunk.length;
            buf = Buffer.concat(bufs, len);
            idx = buf.indexOf(0x0a);
            if (idx !== -1) {
                finish(null, buf.slice(0, idx).toString('ascii'),
                    buf.slice(idx + 1));
            } else if (len > MAX_LINE) {
                finish(new Error('console reply too long'));
            }
        }
    }

    function onEnd() {
        finish(new Error('console closed the connection'));
    }

    sock.on('readable', onReadable);
    sock.on('end', onEnd);
}


function isValidTicket(ticket) {
    return (typeof (ticket) === 'object' && ticket !== null &&
        typeof (ticket.host) === 'string' && net.isIP(ticket.host) !== 0 &&
        typeof (ticket.port) === 'number' && ticket.port > 0 &&
        ticket.port < 65536 &&
        typeof (ticket.token) === 'string' && TOKEN_RE.test(ticket.token));
}


/*
 * Connects to the vmadmd console listener named by ticket and authenticates.
 * Calls cb(err, sock, rest) where rest holds console output that arrived with
 * the OK. On error, err.busy is set when the console is held by someone else.
 */
function connectBackend(ticket, opts, cb) {
    var done = false;
    var sock;
    var timer;

    assert.object(ticket, 'ticket');
    assert.object(opts, 'opts');
    assert.number(opts.connectTimeout, 'opts.connectTimeout');
    assert.func(cb, 'cb');

    function finish(err, rest) {
        if (done) {
            return;
        }
        done = true;
        clearTimeout(timer);
        if (err) {
            sock.destroy();
            cb(err);
            return;
        }
        cb(null, sock, rest);
    }

    timer = setTimeout(function onConnectTimeout() {
        finish(new Error('timed out connecting to console'));
    }, opts.connectTimeout);

    sock = net.connect({host: ticket.host, port: ticket.port});

    // Stays attached for the life of the socket so a late error after
    // finish() cannot go unhandled.
    sock.on('error', function onBackendError(err) {
        finish(new Error('cannot connect to console: ' + err.message));
    });

    sock.once('connect', function onBackendConnect() {
        sock.setNoDelay(true);
        sock.write(ticket.token + '\n');
        readLine(sock, function onReply(err, line, rest) {
            var e;
            var m;

            if (err) {
                finish(err);
                return;
            }
            if (line === 'OK') {
                finish(null, rest);
                return;
            }
            m = /^ERR (.*)$/.exec(line);
            e = new Error(m ? m[1] : 'unexpected reply from console');
            e.busy = (m !== null && m[1] === 'busy');
            finish(e);
        });
    });
}


/*
 * Relays between an accepted websocket and an authenticated backend socket.
 * clientSock is the raw socket under the websocket, used for flow control.
 */
function relay(opts) {
    var backend = opts.backend;
    var clientSock = opts.clientSock;
    var closed = false;
    var closeTimer = null;
    var log = opts.log;
    var paused = false;
    var ws = opts.ws;

    assert.object(backend, 'opts.backend');
    assert.object(clientSock, 'opts.clientSock');
    assert.object(log, 'opts.log');
    assert.object(ws, 'opts.ws');
    assert.number(opts.clientHighWater, 'opts.clientHighWater');
    assert.number(opts.backendMaxBacklog, 'opts.backendMaxBacklog');
    assert.number(opts.closeTimeout, 'opts.closeTimeout');

    function sendToClient(buf) {
        if (closed) {
            return;
        }
        try {
            ws.send(buf);
        } catch (ex) {
            shutdown('failed writing to client: ' + ex.message);
            return;
        }
        if (!paused && clientSock.bufferSize > opts.clientHighWater) {
            paused = true;
            backend.pause();
            clientSock.once('drain', function onClientDrain() {
                paused = false;
                if (!closed) {
                    backend.resume();
                }
            });
        }
    }

    // Close the websocket with a reason, then give the client time to answer
    // the close frame before tearing down the socket.
    function shutdown(reason) {
        if (closed) {
            return;
        }
        closed = true;
        log.info({reason: reason}, 'console session closing');
        backend.destroy();
        try {
            ws.end(reason);
        } catch (_ex) {
            ws.destroy();
            return;
        }
        closeTimer = setTimeout(function onCloseTimeout() {
            ws.destroy();
        }, opts.closeTimeout);
    }

    ws.on('end', function onWsEnd() {
        clearTimeout(closeTimer);
        if (!closed) {
            closed = true;
            log.info('console session ended by client');
        }
        backend.destroy();
    });
    ws.on('error', function onWsError(err) {
        log.warn({err: err}, 'console websocket error');
        shutdown('websocket error');
        ws.destroy();
    });
    ws.on('binary', function onWsBinary(buf) {
        if (closed) {
            return;
        }
        backend.write(buf);
        if (backend.bufferSize > opts.backendMaxBacklog) {
            shutdown('console input backlog exceeded');
        }
    });
    ws.on('text', function onWsText() {
        shutdown('text frames are not supported');
    });

    backend.on('data', sendToClient);
    // readLine() used 'readable', which leaves newer node versions paused.
    backend.resume();
    backend.on('error', function onBackendError(err) {
        log.warn({err: err}, 'console backend error');
        shutdown('console connection error');
    });
    backend.on('close', function onBackendClose() {
        shutdown('console closed');
    });

    if (opts.initial && opts.initial.length > 0) {
        sendToClient(opts.initial);
    }
}


/*
 * Writes a plain HTTP error to a socket whose upgrade we already claimed.
 */
function rejectUpgrade(socket) {
    var err = new restify.InternalServerError();
    var data = JSON.stringify(err.body);

    socket.write('HTTP/1.1 ' + err.statusCode + ' Upgrade Rejected\r\n' +
        'Connection: close\r\n' +
        'Content-Type: application/json\r\n' +
        'Content-Length: ' + Buffer.byteLength(data) + '\r\n\r\n');
    socket.end(data);
}


function startSession(req, res, next) {
    var aborted = false;
    var clientSock = req.connection;
    var log = req.log.child({component: 'console', machine: req.machine.id});
    var opts = DEFAULTS;
    var uri = '/servers/' + req.machine.compute_node + '/vms/' +
        req.machine.id + '/console';

    function onClientGone() {
        aborted = true;
        log.info('client went away before the console was ready');
    }
    clientSock.once('close', onClientGone);

    function fail(err) {
        clientSock.removeListener('close', onClientGone);
        next(err);
    }

    req.sdc.cnapi.post(uri, {}, function onTicket(err, ticket) {
        if (aborted) {
            return;
        }
        if (err) {
            log.error({err: err}, 'CNAPI failed to issue a console ticket');
            if (err.statusCode === 409) {
                fail(new errors.MachineStoppedError());
            } else {
                fail(new errors.ConsoleUnavailableError(
                    'could not get a console ticket'));
            }
            return;
        }
        if (!isValidTicket(ticket)) {
            log.error({ticketType: typeof (ticket)},
                'CNAPI returned an invalid console ticket');
            fail(new errors.ConsoleUnavailableError(
                'could not get a console ticket'));
            return;
        }

        log = log.child({consoleHost: ticket.host, consolePort: ticket.port,
            consoleType: ticket.type});

        connectBackend(ticket, opts, function onBackend(cErr, backend, rest) {
            var upgrade;
            var ws;

            if (aborted) {
                if (backend) {
                    backend.destroy();
                }
                return;
            }
            clientSock.removeListener('close', onClientGone);

            if (cErr) {
                log.warn({err: cErr}, 'console connection failed');
                next(cErr.busy ? new errors.ConsoleBusyError() :
                    new errors.ConsoleUnavailableError(cErr.message));
                return;
            }

            try {
                upgrade = res.claimUpgrade();
                upgrade.socket.setNoDelay(true);
                ws = shed.accept(req, upgrade.socket, upgrade.head, false,
                    ['binary', 'console']);
            } catch (ex) {
                log.error({err: ex}, 'websocket upgrade failed');
                backend.destroy();
                if (upgrade) {
                    rejectUpgrade(upgrade.socket);
                }
                next(upgrade ? undefined : new restify.InternalServerError());
                return;
            }

            // Lets the audit log show that the request upgraded.
            res.statusCode = 101;
            next(); // eslint-disable-line callback-return

            log.info('console session started');
            relay({
                backend: backend,
                clientHighWater: opts.clientHighWater,
                backendMaxBacklog: opts.backendMaxBacklog,
                clientSock: upgrade.socket,
                closeTimeout: opts.closeTimeout,
                initial: rest,
                log: log,
                ws: ws
            });
        });
    });
}


function connectConsole(req, res, next) {
    var vm = req.machine;

    if (!req.config.console_access_enabled) {
        next(new errors.ConsoleAccessDisabledError());
        return;
    }
    if (vm.docker) {
        next(new errors.MachineHasNoConsoleError('docker'));
        return;
    }
    if (CONSOLE_BRANDS.indexOf(vm.brand) === -1) {
        next(new errors.MachineHasNoConsoleError(vm.brand));
        return;
    }
    if (vm.state !== 'running') {
        next(new errors.MachineStoppedError());
        return;
    }
    if (!res.claimUpgrade) {
        next(new errors.UpgradeRequiredError(
            'Console connect endpoint is a websocket and must be upgraded'));
        return;
    }

    /*
     * cloudapi still runs with restify request domains enabled. Leave the
     * request domain so errors in the session, which outlives the request
     * once we send the 101, are not reported against it.
     */
    var reqdom = process.domain;
    if (reqdom && reqdom.domain) {
        reqdom.exit();
    }

    startSession(req, res, next);

    if (reqdom && reqdom.domain) {
        reqdom.enter();
    }
}


function mount(server, before) {
    assert.object(server, 'server');
    assert.ok(before, 'before');

    server.get({
        path: '/:account/machines/:machine/console',
        name: 'ConnectMachineConsole',
        version: [ '9.0.0' ]
    }, before, connectConsole);

    return server;
}


module.exports = {
    mount: mount,
    // Exposed for unit tests.
    _connectBackend: connectBackend,
    _isValidTicket: isValidTicket,
    _relay: relay,
    DEFAULTS: DEFAULTS
};
