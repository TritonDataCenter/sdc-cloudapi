// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');
var restify = require('restify');
var nodemailer = require('nodemailer');

// --- Globals

var EMAIL = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i;

// --- Exported API

module.exports = {
  /**
   * Creates a (post) provisioning hook.
   *
   * Config is the JS object that was converted from the
   * free-form config object that is defined in config.json.
   *
   * This function must return a restify filter that is run as part
   * of a restify "main" chain.
   *
   * @param {Object} configuration object for the selected nodemailer
   *                 transport. Transport can be one of "smtp" or "sendmail",
   *                 and such member should be present on the config object.
   *
   *                 SMTP example:
   *
   *                 smtp: {
   *                     service: 'Gmail', // use well known service
   *                     auth: {
   *                        user: 'test.nodemailer@gmail.com',
   *                        pass: 'Nodemailer123'
   *                     }
   *                 }
   *
   *                 Sendmail example:
   *
   *                 sendmail: '/usr/sbin/sendmail'
   *
   * @return {Function} restify filter
   */
    postProvision: function (cfg) {

        if (!cfg || typeof (cfg) !== 'object') {
            throw new TypeError('config (cfg) is required');
        }
        var transport;

        if (cfg.smtp && typeof (cfg.smtp) === 'object') {
            nodemailer.SMTP = cfg.smtp;
            transport = nodemailer.createTransport('SMTP', cfg.smtp);
        } else if (cfg.sendmail && typeof (cfg.sendmail) === 'string') {
            transport = nodemailer.createTransport('Sendmail', cfg.sendmail);
        } else {
            throw new TypeError('cfg.smtp or cfg.sendmail is required');
        }

        if (!cfg.from || typeof (cfg.from) !== 'string' ||
            !EMAIL.test(cfg.from)) {
            throw new TypeError('cfg.from is required (email)');
        }

        if (!cfg.subject || typeof (cfg.subject) !== 'string') {
            throw new TypeError('cfg.subject is required (string)');
        }
        if (!cfg.text || typeof (cfg.text) !== 'string') {
            throw new TypeError('cfg.text is required (string)');
        }

        return function (req, res, next) {
            assert.ok(req.account);
            assert.ok(req.log);

            var message = {
                from: cfg.from,
                to: req.account.email,
                subject: cfg.subject,
                text: cfg.text
            };

            transport.sendMail(message, function (error) {
                if (error) {
                    req.log.error({
                        err: error
                    }, 'Email failure');
                } else {
                    req.log.info('Email sent');
                }

                return next();

            });
        };
    }
};
