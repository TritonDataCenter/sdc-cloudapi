/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * Shared common functions for CloudAPI.
 */

var assert = require('assert-plus');
var VError = require('verror');

/**
 * Parse a boolean from a string or boolean parameter (e.g. from an HTTP
 * query or body param.
 *
 *      PARAM           RETURN VALUE
 *      ------------- | ------------
 *      true          | true
 *      false         | false
 *      'true'        | true
 *      'false'       | false
 *      undefined     | false
 *      anything else | throws an error
 *
 * @param {String|Boolean} param - The param string or boolean. It can also be
 *      `undefined` (for a `false` response) to allow calling code to do:
 *             var follow = common.boolFromParam(req.query.follow);
 * @param {String} name - Optional. If given, and if the value is invalid,
 *      then this name is used in the error message.
 * @returns {Boolean}
 */
function boolFromParam(param, name) {
    assert.optionalString(name, 'name');

    switch (param) {
        case true:
            return true;
        case false:
            return false;
        case 'true':
            return true;
        case 'false':
            return false;
        case undefined:
            return false;
        default:
            if (name) {
                throw new VError('%s param is not a valid boolean: %j',
                    name, param);
            } else {
                throw new VError('param is not a valid boolean: %j', param);
            }
    }
}

module.exports = {
    boolFromParam: boolFromParam
};
