/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2026 Edgecast Cloud LLC.
 */

/*
 * ConnectMachineConsole *unit* tests: ticket validation, the vmadmd token
 * exchange and the websocket relay.
 */

var EventEmitter = require('events').EventEmitter;
var net = require('net');
var test = require('tape');
var util = require('util');

var bunyan = require('bunyan');

var consoleEndpoint = require('../lib/endpoints/console');


var TOKEN = new Array(65).join('b');
var log = bunyan.createLogger({name: 'console-unit', level: 'fatal'});


// --- Helpers

/*
 * Fake vmadmd listener. onToken(line, sock) decides the reply.
 */
function fakeBroker(onToken, cb) {
    var server = net.createServer(function (c) {
        var buf = '';

        c.on('data', function onData(d) {
            var idx;

            buf += d.toString();
            idx = buf.indexOf('\n');
            if (idx === -1) {
                return;
            }
            c.removeListener('data', onData);
            onToken(buf.slice(0, idx), c);
        });
    });

    server.listen(0, '127.0.0.1', function () {
        cb(server, {
            host: '127.0.0.1',
            port: server.address().port,
            token: TOKEN,
            type: 'zone',
            expires_in: 30
        });
    });
}

function FakeWs() {
    EventEmitter.call(this);
    this.sent = [];
    this.ended = null;
    this.destroyed = false;
}
util.inherits(FakeWs, EventEmitter);

FakeWs.prototype.send = function (buf) {
    this.sent.push(buf.toString());
};

FakeWs.prototype.end = function (reason) {
    this.ended = reason;
};

FakeWs.prototype.destroy = function () {
    this.destroyed = true;
};

function FakeClientSock() {
    EventEmitter.call(this);
    this.bufferSize = 0;
}
util.inherits(FakeClientSock, EventEmitter);

function relayOpts(overrides) {
    var opts = {
        clientHighWater: consoleEndpoint.DEFAULTS.clientHighWater,
        backendMaxBacklog: consoleEndpoint.DEFAULTS.backendMaxBacklog,
        closeTimeout: 50,
        log: log
    };

    Object.keys(overrides).forEach(function (k) {
        opts[k] = overrides[k];
    });
    return opts;
}

function connectOk(server, ticket, cb) {
    consoleEndpoint._connectBackend(ticket, {connectTimeout: 1000},
        function (err, sock, rest) {
            cb(err, sock, rest, server);
        });
}


// --- Tests

test('isValidTicket', function (t) {
    var good = {host: '10.0.0.5', port: 4000, token: TOKEN, type: 'zone'};
    var isValid = consoleEndpoint._isValidTicket;

    t.ok(isValid(good), 'valid ticket');
    t.notOk(isValid(null), 'null');
    t.notOk(isValid({host: 'cn1.example.com', port: 4000, token: TOKEN}),
        'hostname instead of IP');
    t.notOk(isValid({host: '10.0.0.5', port: 70000, token: TOKEN}),
        'port out of range');
    t.notOk(isValid({host: '10.0.0.5', port: 4000, token: 'abc'}),
        'short token');
    t.notOk(isValid({host: '10.0.0.5', port: 4000, token: TOKEN + '\n'}),
        'token with newline');
    t.end();
});

test('connectBackend sends the token and keeps output sent with OK',
    function (t) {
    fakeBroker(function (line, c) {
        t.equal(line, TOKEN, 'token sent');
        c.write('OK\nlogin: ');
        c.end();
    }, function (server, ticket) {
        connectOk(server, ticket, function (err, sock, rest) {
            t.ifError(err);
            t.equal(rest.toString(), 'login: ');
            sock.destroy();
            server.close();
            t.end();
        });
    });
});

test('connectBackend reports busy', function (t) {
    fakeBroker(function (_line, c) {
        c.end('ERR busy\n');
    }, function (server, ticket) {
        connectOk(server, ticket, function (err) {
            t.ok(err, 'error');
            t.equal(err.busy, true, 'busy flag');
            server.close();
            t.end();
        });
    });
});

test('connectBackend reports other errors', function (t) {
    fakeBroker(function (_line, c) {
        c.end('ERR invalid token\n');
    }, function (server, ticket) {
        connectOk(server, ticket, function (err) {
            t.equal(err.message, 'invalid token');
            t.equal(err.busy, false);
            server.close();
            t.end();
        });
    });
});

test('connectBackend times out', function (t) {
    fakeBroker(function () {
        // never reply
    }, function (server, ticket) {
        consoleEndpoint._connectBackend(ticket, {connectTimeout: 50},
            function (err) {
            t.ok(/timed out/.test(err.message), err.message);
            server.close();
            t.end();
        });
    });
});

test('connectBackend handles refused connections', function (t) {
    var server = net.createServer();

    server.listen(0, '127.0.0.1', function () {
        var port = server.address().port;

        server.close(function () {
            consoleEndpoint._connectBackend({host: '127.0.0.1', port: port,
                token: TOKEN}, {connectTimeout: 1000}, function (err) {
                t.ok(/cannot connect/.test(err.message), err.message);
                t.end();
            });
        });
    });
});

test('relay moves data both ways and closes with the backend',
    function (t) {
    fakeBroker(function (_line, c) {
        c.write('OK\n');
        c.on('data', function (d) {
            c.write('echo:' + d.toString());
            c.end();
        });
    }, function (server, ticket) {
        connectOk(server, ticket, function (err, sock, rest) {
            var ws = new FakeWs();

            t.ifError(err);
            consoleEndpoint._relay(relayOpts({backend: sock,
                clientSock: new FakeClientSock(), initial: rest, ws: ws}));
            ws.emit('binary', Buffer.from('hi'));

            sock.on('close', function () {
                setImmediate(function () {
                    t.deepEqual(ws.sent, ['echo:hi']);
                    t.equal(ws.ended, 'console closed');
                    setTimeout(function () {
                        t.ok(ws.destroyed, 'destroyed after close timeout');
                        server.close();
                        t.end();
                    }, 100);
                });
            });
        });
    });
});

test('relay pauses the console while the client is backed up',
    function (t) {
    var peer;

    fakeBroker(function (_line, c) {
        peer = c;
        c.write('OK\n');
    }, function (server, ticket) {
        connectOk(server, ticket, function (err, sock) {
            var clientSock = new FakeClientSock();
            var ws = new FakeWs();

            t.ifError(err);
            consoleEndpoint._relay(relayOpts({backend: sock,
                clientHighWater: 10, clientSock: clientSock, ws: ws}));

            clientSock.bufferSize = 100;
            peer.write('first');
            setTimeout(function () {
                t.deepEqual(ws.sent, ['first']);
                t.equal(sock.isPaused(), true, 'backend paused');
                peer.write('second');
                setTimeout(function () {
                    t.deepEqual(ws.sent, ['first'], 'nothing while paused');
                    clientSock.bufferSize = 0;
                    clientSock.emit('drain');
                    setTimeout(function () {
                        t.deepEqual(ws.sent, ['first', 'second']);
                        ws.emit('end');
                        server.close();
                        t.end();
                    }, 50);
                }, 50);
            }, 50);
        });
    });
});

test('relay drops sessions that exceed the input backlog', function (t) {
    fakeBroker(function (_line, c) {
        c.write('OK\n');
        c.pause(); // never read client input
    }, function (server, ticket) {
        connectOk(server, ticket, function (err, sock) {
            var big = Buffer.alloc(64 * 1024, 0x61);
            var i;
            var ws = new FakeWs();

            t.ifError(err);
            consoleEndpoint._relay(relayOpts({backend: sock,
                backendMaxBacklog: 128 * 1024,
                clientSock: new FakeClientSock(), ws: ws}));

            for (i = 0; i < 64 && ws.ended === null; i++) {
                ws.emit('binary', big);
            }
            t.equal(ws.ended, 'console input backlog exceeded');
            t.ok(sock.destroyed, 'backend destroyed');
            server.close();
            t.end();
        });
    });
});

test('relay rejects text frames', function (t) {
    fakeBroker(function (_line, c) {
        c.write('OK\n');
    }, function (server, ticket) {
        connectOk(server, ticket, function (err, sock) {
            var ws = new FakeWs();

            t.ifError(err);
            consoleEndpoint._relay(relayOpts({backend: sock,
                clientSock: new FakeClientSock(), ws: ws}));
            ws.emit('text', 'ls\n');
            t.equal(ws.ended, 'text frames are not supported');
            t.ok(sock.destroyed, 'backend destroyed');
            server.close();
            t.end();
        });
    });
});

test('relay tears down the backend when the client leaves', function (t) {
    fakeBroker(function (_line, c) {
        c.write('OK\n');
    }, function (server, ticket) {
        connectOk(server, ticket, function (err, sock) {
            var ws = new FakeWs();

            t.ifError(err);
            consoleEndpoint._relay(relayOpts({backend: sock,
                clientSock: new FakeClientSock(), ws: ws}));
            ws.emit('end');
            t.ok(sock.destroyed, 'backend destroyed');
            t.equal(ws.ended, null, 'no close frame needed');
            server.close();
            t.end();
        });
    });
});
