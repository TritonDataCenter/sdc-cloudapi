/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * CloudAPI Benchmark Suite.
 *
 * This file will be used by bench.js to fork child processes,
 * (as many as concurrent requests). These child processes will be in
 * charge of running one request each and report results to parent process.
 */

var common = require('./common');
function notifyParent(msg) {
    process.send(msg);
}

// Expected to receive messages from parent process with the desired smartdc
// method name and any of the required arguments for such method invocation.
//
// Please, note we're intentionally not recycling the sdc client between
// messages due to each new message could be associated with a new user
process.on('message', function (msg) {
    var sdc;
    if (!msg.user || !msg.key || !msg.fp) {
        return notifyParent({
            error: new Error('Missing required arguments user, key and/or fp'),
            uuid: msg.uuid
        });
    }
    sdc = common.createSDCClient(msg.user, msg.key, msg.fp);

    if (msg.method && msg.args && typeof (sdc[msg.method]) === 'function') {
        msg.args.push(function (err, obj, response) {
            // Wait for provisioning jobs before we go further here:
            if (msg.method === 'createMachine' && !err) {
                var r = {
                    error: err,
                    headers: response.headers,
                    reqHeaders: response.req._headers,
                    statusCode: response.statusCode,
                    method: msg.method,
                    uuid: msg.uuid,
                    obj: obj
                };
                var pTimeOut, anInterval;
                pTimeOut = setTimeout(function () {
                    clearInterval(anInterval);
                    return notifyParent(r);
                }, 5 * 60 * 1000); // Waiting 5 minutes for provisions

                // Check for success every 10 seconds:
                anInterval = setInterval(function () {
                    sdc.getMachineAudit(obj.id, function (_err2, obj2, res2) {
                        if (obj2.length && obj2[0].action === 'provision') {
                            clearInterval(anInterval);
                            clearTimeout(pTimeOut);
                            r.success = obj2[0].success;
                            return notifyParent(r);
                        }
                        return (true);
                    });
                }, 10 * 1000);
                return (true);
            } else {
                return notifyParent({
                    error: err,
                    headers: response.headers,
                    reqHeaders: response.req._headers,
                    statusCode: response.statusCode,
                    method: msg.method,
                    uuid: msg.uuid,
                    obj: obj
                });
            }
        });
        return sdc[msg.method].apply(sdc, msg.args);
    } else {
        return notifyParent({
            error: new Error('Unknown message received'),
            uuid: msg.uuid
        });
    }
});
