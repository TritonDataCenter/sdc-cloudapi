/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

var test = require('tape').test;
var plugin = require('../../plugins/machine_email');


// --- Globals


var API = {
    log: {
        info: function () {},
        debug: function () {},
        error: function () {}
    }
};

var SENDER;


// --- Tests


test('setup postProvision without api',
function (t) {
    try {
        plugin.postProvision();
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'api (object) is required', 'err message');
    }

    t.end();
});


test('Setup postProvision without cfg',
function (t) {
    try {
        plugin.postProvision(API);
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'cfg (object) is required', 'err message');
    }

    t.end();
});


test('Setup postProvision with invalid cfg',
function (t) {
    try {
        plugin.postProvision(API, {
            smtp: 'foo'
        });
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message,
            'cfg.smtp || cfg.sendmaili || cfg.test (object) is required',
            'err message');
    }

    try {
        plugin.postProvision(API, {
            smtp: {}
        });
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'cfg.from (string) is required');
    }

    try {
        plugin.postProvision(API, {
            smtp: {},
            from: 'foobar'
        });
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'cfg.from (email) is required');
    }

    try {
        plugin.postProvision(API, {
            smtp: {},
            from: 'sender@example.com'
        });
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'cfg.subject (string) is required');
    }

    try {
        plugin.postProvision(API, {
            smtp: {},
            from: 'sender@example.com',
            subject: 'test subject'
        });
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'cfg.text (string) is required');
    }

    t.end();
});


test('Setup postProvision with smtp',
function (t) {
    plugin.postProvision(API, {
        from: 'sender@example.com',
        subject: 'test subject',
        text: 'test body',
        smtp: {
            service: 'Gmail',
            auth: {
                user: 'example@example.com',
                pass: 'userpass'
            }
        }
    });

    t.end();
});


test('Setup postProvision with sendmail',
function (t) {
    plugin.postProvision(API, {
        from: 'sender@example.com',
        subject: 'test subject',
        text: 'test body',
        sendmail: {
            path: '/usr/sbin/sendmail'
        }
    });

    t.end();
});


test('Setup postProvision with test stub',
function (t) {
    SENDER = plugin.postProvision(API, {
        from: 'sender@example.com',
        subject: 'test subject',
        text: 'test body',
        test: {
            sendMail: function sendMailStub(obj, cb) {
                cb(null, obj);
            }
        }
    });

    t.end();
});


test('postProvision',
function (t) {
    SENDER({
        account: { email: 'receiver@example.com' }
    }, function senderCb(err) {
        t.ifErr(err, 'err');
        t.end();
    });
});


test('postProvision - badargs',
function (t) {
    try {
        SENDER({}, function senderCb() {
            t.fail('should not cb');
        });
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'opts.account (object) is required');
    }

    try {
        SENDER({ account: {} }, function sender2Cb() {
            t.fail('should not cb');
        });
        t.fail('exception not thrown');
    } catch (e) {
        t.equal(e.message, 'opts.account.email (string) is required');
    }

    t.end();
});
