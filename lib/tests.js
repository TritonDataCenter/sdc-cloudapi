/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * This file contains functions useful during the testing of Cloudapi. They
 * are only active when the configuration has Cloudapi in testing mode.
 */

var assert = require('assert-plus');


function throwException(req, res, next) {
    // non-existent function invocation should throw exception
    req.asdasdadasdasd();
    next();
}


function mount(server, before, config) {
    assert.object(server);
    assert.ok(before);
    assert.ok(config);

    if (!config.test) {
        return server;
    }

    server.get({
        path: '/:account/tests/throw_exception',
        name: 'ThrowException'
    }, before, throwException);

    return server;
}


module.exports = {
    mount: mount
};
