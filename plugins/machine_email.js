/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * Sends an email after a VM/container has been successfully provisioned.
 *
 * To configure this plugin, provide the following configuration attributes:
 *
 * - from: email address that will be in the From field send to the client.
 * - subject: what the subject line will be.
 * - text: what the body of the email will be.
 *
 * In addition, the transport (sendmail or direct SMTP) requires configuration.
 * To send through Sendmail, add the following attribute:
 *
 * - sendmail: {
 *     path: full path to sendmail binary
 * }
 *
 * To send through SMTP:
 *
 * - smtp: {
 *     host: hostname of SMTP server
 *     secureConnection: true to use SSL,
 *     port: SMTP port,
 *     auth: {
 *         user: ...
 *         pass: ...
 *     }
 * }
 *
 * A full example, using sendmail:
 *
 * {
 *     "name": "machine_email",
 *     "enabled": true,
 *     "config": {
 *         "from": "sender@example.com",
 *         "subject": "A new container has been provisioned",
 *         "text": "All toasty and ready for use!",
 *         "sendmail": {
 *             "path": "/usr/sbin/sendmail"
 *         }
 *     }
 * }
 *
 * This is added to CLOUDAPI_PLUGINS and DOCKER_PLUGINS, serialized to JSON,
 * and PUT to cloudapi's and sdc-docker's sapi services.
 *
 * E.g. for cloudapi:
 *
 * sdc-sapi /services/$(sdc-sapi /services?name=cloudapi | json -Ha uuid) -X PUT
 * -d '{
 *    "metadata": {
 *         "CLOUDAPI_PLUGINS": "[{\"name\":\"machine_email\",\"enabled\":true, \
 *         \"config\":{\"from\":\"sender@example.com\",\"subject\": \
 *         \"A new container has been provisioned\",\"text\": \
 *         \"All toasty and ready for use!\", \
 *         \"sendmail\":{\"path\":\"/usr/sbin/sendmail\"}}}]"
 *    }
 * }'
 */


var assert = require('assert-plus');
var nodemailer = require('nodemailer');


// --- Globals


var EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i;


/*
 * Given a provision, send an email to the client who provisioned.
 *
 * Calls cb(). No error will ever be returned.
 */
function postProvisionEmail(api, cfg) {
    assert.object(api, 'api');
    assert.object(api.log, 'api.log');
    assert.object(cfg, 'cfg');
    assert.object(cfg.smtp || cfg.sendmail || cfg.test,
        'cfg.smtp || cfg.sendmaili || cfg.test');
    assert.string(cfg.from, 'cfg.from');
    assert.ok(EMAIL_RE.test(cfg.from), 'cfg.from (email) is required');
    assert.string(cfg.subject, 'cfg.subject');
    assert.string(cfg.text, 'cfg.text');

    var log = api.log;
    var from = cfg.from;
    var subject = cfg.subject;
    var text = cfg.text;

    var transport;
    if (cfg.smtp) {
        transport = nodemailer.createTransport('SMTP', cfg.smtp);
    } else if (cfg.sendmail) {
        assert.string(cfg.sendmail.path, 'cfg.sendmail.path');
        transport = nodemailer.createTransport('SENDMAIL', cfg.sendmail.path);
    } else {
        transport = cfg.test; // for testing purposes
    }

    return function sendPostProvisionEmail(opts, cb) {
        assert.object(opts, 'opts');
        assert.object(opts.account, 'opts.account');
        assert.string(opts.account.email, 'opts.account.email');
        assert.func(cb, 'cb');

        log.debug('Running', sendPostProvisionEmail.name);

        var to = opts.account.email;

        transport.sendMail({
            from: from,
            to: to,
            subject: subject,
            text: text
        }, function sendMailCb(err) {
            if (err) {
                log.error({ err: err }, 'Email failure');
            } else {
                log.info('Email sent');
            }

            cb();
        });
    };
}


module.exports = {
    postProvision: postProvisionEmail
};
