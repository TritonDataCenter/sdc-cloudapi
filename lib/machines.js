// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var querystring = require('querystring');
var util = require('util');

var restify = require('restify');
var uuid = require('node-uuid');



// --- Globals

var InvalidArgumentError = restify.InvalidArgumentError;
var MissingParameterError = restify.MissingParameterError;
var ResourceNotFoundError = restify.ResourceNotFoundError;
var RestError = restify.RestError;

var MD_RE = /^metadata\.\w/;
var TAG_RE = /^tag\..+/;

var sprintf = util.format;



// --- Helpers


function KeyRequiredError(dataset) {
    assert.ok(dataset);

    var message = sprintf('At least one SSH key is required to provision %s',
                          dataset);

    RestError.call(this, 409, 'KeyRequired', message, KeyRequiredError);

    this.name = 'KeyRequiredError';
}
util.inherits(KeyRequiredError, RestError);


function translateState(state) {
    switch (state) {
    case 'configured':
    case 'incomplete':
    case 'ready':
    case 'unavailable':
        state = 'provisioning';
        break;
    case 'running':
        state = 'running';
        break;
    case 'halting':
    case 'shutting_down':
        state = 'stopping';
        break;
    case 'off':
    case 'down':
    case 'installed':
        state = 'stopped';
        break;
    case 'unreachable':
        state = 'offline';
        break;
    case 'destroyed':
        state = 'deleted';
        break;
    default:
        state = 'unknown';
        break;
    }

    return state;
}


function translate(machine, credentials) {
    assert.ok(machine);

    var msg = {
        id: machine.name,
        name: machine.alias,
        type: machine.type === 'zone' ? 'smartmachine' : 'virtualmachine',
        state: translateState(machine.running_status),
        dataset: machine.dataset_urn,
        image: {
            id: machine.dataset_uuid,
            urn: machine.dataset_urn
        },
        ips: [],
        memory: machine.ram,
        disk: machine.disk,
        metadata: machine.customer_metadata || {},
        'package': machine.internal_metadata.package_name,
        tags: machine.tags,
        credentials: {},
        created: machine.created,
        updated: machine.updated
    };

    machine.ips.forEach(function (ip) {
        msg.ips.push(ip.address);
    });

    if (credentials && machine.credentials.length) {
        msg.metadata.credentials = {};
        machine.credentials.forEach(function (c) {
            msg.metadata.credentials[c.username] = c.password;
            msg.credentials[c.username] = c.password;
        });
    }

    return msg;
}


// Note the throws in this function are ok, as restify is contractually
// obligated to catch them and do res.send for us
function getListOptions(req) {
    assert.ok(req);

    var opts = {};

    switch (req.params.state) {
    case 'provisioning':
        opts.status = 'unknown';
        break;
    case 'stopping':
        opts.status = 'halting';
        break;
    case 'stopped':
        opts.status = 'off';
        break;
    case 'running':
        opts.status = 'running';
        break;
    case 'unknown':
        opts.status = 'unknown';
        break;
    case undefined:
        break;
    default:
        throw new InvalidArgumentError('%s is not a valid state',
                                       req.params.state);
    }

    switch (req.params.type) {
    case 'smartmachine':
        opts.type = 'zone';
        break;
    case 'virtualmachine':
        opts.type = 'vm';
        break;
    case undefined:
        break;
    default:
        throw new InvalidArgumentError('%s is not a valid type',
                                       req.params.type);
    }
    if (req.params.dataset) {
        opts.dataset = req.params.dataset;
    }
    // Not implemented right now into VMAPI
    opts.limit = req.params.limit || 1000;

    if (req.params.memory) {
        opts.ram = req.params.memory;
    }

    if (req.params.name) {
        opts.alias = req.params.name;
    }
    // Not implemented right now into VMAPI
    opts.offset = req.params.offset || 0;

    if (req.params['package']) {
        opts['package'] = req.params['package'];
    }

    // Copy in any and all tags
    Object.keys(req.params).forEach(function (k) {
        if (TAG_RE.test(k)) {
            opts[k] = req.params[k];
        }
    });
    if (req.params.tombstone) {
        opts.tombstone = req.params.tombstone;
    }

    return opts;
}


function getCreateOptions(req) {
    assert.ok(req);

    var opts = {
        dataset_uuid: req.dataset.uuid,
        'package': req.pkg.name
    };

    opts.alias = req.params.name || uuid().replace(/-/, '').substr(0, 7);

    if (req.params.password) {
        opts.password = req.params.password;
    }

    if (req.root_authorized_keys) {
        opts.root_authorized_keys = req.root_authorized_keys;
    }

    // Copy in all the tags and metadata
    var metadata = {};
    Object.keys(req.params).forEach(function (k) {
        if (TAG_RE.test(k)) {
            opts[k] = req.params[k];
        } else if (MD_RE.test(k)) {
            metadata[k.replace(/^metadata\./, '')] = req.params[k];
        }
    });

    if (Object.keys(metadata).length) {
        opts.customer_metadata = JSON.stringify(metadata);
    }

    return opts;
}


function updateCallback(req, res, next) {
    var log = req.log;

    return function callback(err) {
        if (err) {
            return next(err);
        }

        var m = req.params.machine;
        log.debug('%s (%s/%s): ok', req.action, req.account.login, m);
        res.send(202);
        return next(false);
    };
}


function xorIfPresent(a, b) {
    if (!a && !b) {
        return true;
    }
    return (!a != !b);
}



// --- Handlers

function imageToDataset(req, res, next) {
    if (!xorIfPresent(req.params.dataset, req.params.image)) {
        return next(new InvalidArgumentError('image and dataset are ' +
                                             'mutually exclusive parameters.'));
    }

    req.params.dataset = req.params.dataset || req.params.image;
    return next();
}


function ensureDataset(req, res, next) {
    if (!req.dataset) {
        if (req.params.dataset) {
            return next(new InvalidArgumentError('%s is not a valid image',
                                                 req.params.dataset));
        }

        return next(new MissingParameterError('image must be specified'));
    }

    return next();
}


function ensurePackage(req, res, next) {
    if (!req.pkg) {
        if (req.params['package']) {
            return next(new InvalidArgumentError('%s is not a valid package',
                                                 req.params['package']));
        }
        return next(new MissingParameterError('package must be specified'));
    }

    return next();
}


function checkPassword(req, res, next) {
    // If it's a 'passworded' dataset (i.e. win32), don't look up ssh keys
    if (req.dataset.requirements && req.dataset.requirements.password) {
        if (!req.params.password) {
            return next(new MissingParameterError('%s requires a password',
                                                  req.dataset.urn));
        }
        req.noKeys = true;
    }

    return next();
}


function loadSSHKeys(req, res, next) {
    assert.ok(req.sdc);

    if (req.noKeys) {
        return next();
    }

    var log = req.log;

    return req.account.listKeys(function (err, keys) {
        if (err) {
            return next(err);
        }

        if (!keys || !keys.length) {
            return next(new KeyRequiredError(req.dataset.urn));
        }

        req.root_authorized_keys = '';
        req.keys = keys;
        keys.forEach(function (k) {
            req.root_authorized_keys += k.openssh + '\n';
        });

        log.debug({
            customer: req.account.uuid,
            root_authorized_keys: req.root_authorized_keys
        }, 'Loaded keys for %s', req.account.login);

        return next();
    });
}


function create(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        log = req.log,
        login = req.account.login,
        name = req.params.machine,
        opts = getCreateOptions(req);

    return req.sdc.vmapi.createMachine(customer, opts, function (err, machine) {
        if (err) {
            return next(err);
        }

        machine = translate(machine, req.params.credentials);

        res.header('Location', sprintf('/%s/machines/%s', login, machine.id));
        log.debug('GetMachine(/%s/%s) => %j', customer, name, machine);
        res.send(201, machine);
        return next();
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        log = req.log,
        opts = getListOptions(req);

    opts.owner_uuid = customer;

    return req.sdc.vmapi.listVms(opts, function (err, machines) {
        if (err) {
            return next(err);
        }

        var _machines = [];
        machines.forEach(function (m) {
            _machines.push(translate(m, req.params.credentials));
        });

        res.header('x-query-limit', opts.limit);
        res.header('x-resource-count', _machines.length);

        log.debug('ListMachines(%s) => %j', customer, _machines);
        res.send(_machines);
        return next();
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        log = req.log,
        name = req.params.machine;

    return req.sdc.vmapi.getMachine(customer, name, function (err, machine) {
        if (err) {
            return next(err);
        }

        machine = translate(machine, req.params.credentials);

        log.debug('GetMachine(%s/%s) => %j', customer, name, machine);
        res.send((machine.state === 'deleted' ? 410 : 200), machine);
        return next();
    });
}


function start(req, res, next) {
    if (req.params.action !== 'start') {
        return next();
    }

    var customer = req.account.uuid,
        machine = req.params.machine,
        callback = updateCallback(req, res, next);

    return req.sdc.vmapi.startMachine(customer, machine, callback);
}


function stop(req, res, next) {
    if (req.params.action !== 'stop') {
        return next();
    }

    var customer = req.account.uuid,
        machine = req.params.machine,
        callback = updateCallback(req, res, next);

    return req.sdc.vmapi.shutdownMachine(customer, machine, callback);
}


function reboot(req, res, next) {
    if (req.params.action !== 'reboot') {
        return next();
    }

    var customer = req.account.uuid,
        machine = req.params.machine,
        callback = updateCallback(req, res, next);

    return req.sdc.vmapi.rebootMachine(customer, machine, callback);
}


function resize(req, res, next) {
    if (req.params.action !== 'resize') {
        return next();
    }
    // Don't let the user resize to the default
    if (!req.params['package']) {
        return next(new MissingParameterError('package must be specified'));
    }

    var customer = req.account.uuid,
        machine = req.params.machine,
        pkg = req.params['package'],
        callback = updateCallback(req, res, next);

    return req.sdc.vmapi.resizeZone(customer, machine, pkg, callback);
}


function del(req, res, next) {
    var customer = req.account.uuid,
        machine = req.params.machine,
        log = req.log;

    return req.sdc.vmapi.deleteMachine(customer, machine, function (err) {
        if (err) {
            return next(err);
        }

        log.debug('rm %s/%s successful', req.account.login, machine);
        res.send(204);
        return next();
    });
}


function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.post(
        {
            path: '/:account/machines',
            name: 'CreateMachine'
        },
        before,
        imageToDataset,
        ensureDataset,
        ensurePackage,
        checkPassword,
        loadSSHKeys,
        create);

    // The update handlers all check "should I run?" and if they should,
    // the chain stops.  To handle the case where the user specified a bogus
    // action
    server.post(
        {
            path: '/:account/machines/:machine',
            name: 'UpdateMachine'
        },
        before,
        start,
        stop,
        reboot,
        resize,
        function invalidAction(req, res, next) {
            if (req.params.action) {
                return next(new InvalidArgumentError('%s is not a valid action',
                                                     req.params.action));
            }

            return next(new MissingParameterError('action is required'));
        });

    server.get(
        {
            path: '/:account/machines',
            name: 'ListMachines'
        },
        before,
        imageToDataset,
        list);

    server.head(
        {
            path: '/:account/machines',
            name: 'HeadMachines'
        },
        before,
        imageToDataset,
        list);

    server.get(
        {
            path: '/:account/machines/:machine',
            name: 'GetMachine'
        },
        before,
        get);

    server.head(
        {
            path: '/:account/machines/:machine',
            name: 'HeadMachine'
        },
        before,
        get);

    server.del(
        {
            path: '/:account/machines/:machine',
            name: 'DeleteMachine'
        },
        before,
        del);

    return server;
}


///--- Exports

module.exports = {
    mount: mount
};
