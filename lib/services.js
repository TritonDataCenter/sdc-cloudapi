/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Services are defined using CloudAPI configuration file. They are a
 * small list of service URLs for services supported for this DC,
 * e.g. cloudapi, docker, etc.
 */

var assert = require('assert-plus');
var resources = require('./resources');



// --- Functions

function list(req, res, next) {
    assert.ok(req.config);
    if (req.accountMgmt) {
        resources.getRoleTags(req, res);
    }
    res.send(req.config.services || {});
    next();
}


function mount(server, before) {
    assert.object(server);
    assert.ok(before);

    server.get({
        path: '/:account/services',
        name: 'ListServices'
    }, before, list);

    return server;
}



// --- API

module.exports = {
    mount: mount
};
