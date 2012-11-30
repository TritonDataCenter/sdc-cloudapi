// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var restify = require('restify');
var uuid = require('node-uuid');


// --- Globals

var InvalidArgumentError = restify.InvalidArgumentError;
var MissingParameterError = restify.MissingParameterError;
var ResourceNotFoundError = restify.ResourceNotFoundError;
var InternalError = restify.InternalError;
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
    case 'unavailable':
    case 'provisioning':
        state = 'provisioning';
        break;
    // Cause ready happens now during reboot only:
    case 'ready':
        state = 'ready';
        break;
    case 'running':
        state = 'running';
        break;
    case 'halting':
    case 'stopping':
    case 'shutting_down':
        state = 'stopping';
        break;
    case 'off':
    case 'down':
    case 'installed':
    case 'stopped':
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


function translate(machine, credentials, datasets) {
    assert.ok(machine);

    var msg = {
        id: machine.uuid,
        name: machine.alias,
        type: machine.brand === 'kvm' ? 'virtualmachine' : 'smartmachine',
        state: translateState(machine.state),
        image: {
            id: machine.dataset_uuid
        },
        ips: [],
        memory: machine.ram,
        disk: machine.quota || 0,
        metadata: machine.customer_metadata || {},
        'package': (machine.package_name) ?
                                machine.package_name : '',
        tags: machine.tags,
        credentials: {},
        created: machine.create_timestamp || '',
        updated: machine.last_modified || ''
    }, dataset;

    datasets = datasets.filter(function (d) {
        return (d.uuid === machine.dataset_uuid);
    });

    if (datasets.length) {
        dataset = datasets[0];
        msg.dataset = dataset.urn;
        msg.image.urn = dataset.urn;
    }

    if (machine.nics && machine.nics.length) {
        machine.nics.forEach(function (nic) {
            msg.ips.push(nic.ip);
        });
    }

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
        opts.status = 'provisioning';
        break;
    case 'stopping':
        opts.status = 'halting';
        break;
    case 'stopped':
        opts.status = 'stopped';
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
    // By default, VMAPI will return everything unless it's told to do not
    // retrieve destroyed machines.
    if (!req.params.tombstone) {
        opts.state = 'active';
    }

    return opts;
}


function getCreateOptions(req) {
    assert.ok(req);

    var brand = (req.dataset.brand) ? req.dataset.brand :
                (req.dataset.type === 'zvol') ? 'kvm' : 'joyent';

    var opts = {
        image_uuid: req.dataset.uuid,
        image_os: req.dataset.os,
        image_name: req.dataset.name,
        'package': req.pkg.uuid,
        ram: req.pkg.max_physical_memory,
        brand: brand,
        // TODO: Review when we decide anything regarding networks:
        networks: req.nets,
        package_name: req.pkg.name,
        package_version: req.pkg.version,
        billing_id: req.pkg.uuid
    }, metadata = {}, tags = {};

    opts.alias = req.params.name || uuid().replace(/-/, '').substr(0, 7);

    // TODO: Need to check if this is handled by VMAPI now:
    if (req.params.password) {
        opts.password = req.params.password;
    }

    // TODO: Not sure if these are handled by VMAPI now?.
    if (req.root_authorized_keys) {
        opts.root_authorized_keys = req.root_authorized_keys;
    }

    // Copy in all the tags and metadata
    Object.keys(req.params).forEach(function (k) {
        if (TAG_RE.test(k)) {
            tags[k.replace(/^tag\./, '')] = req.params[k];
        } else if (MD_RE.test(k)) {
            metadata[k.replace(/^metadata\./, '')] = req.params[k];
        }
    });

    if (Object.keys(tags).length) {
        opts.tags = JSON.stringify(tags);
    }

    if (Object.keys(metadata).length) {
        opts.customer_metadata = JSON.stringify(metadata);
    }

    if (req.dataset.disk_driver) {
        opts.disk_driver = req.dataset.disk_driver;
    }

    if (req.dataset.nic_driver) {
        opts.nic_driver = req.dataset.nic_driver;
    }

    // Intentionally not documented, at least until we are checking on
    // vmapi that owner is allowed to specify a given server:
    if (req.params.server_uuid) {
        opts.server_uuid = req.params.server_uuid;
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

    if (req.pkg.active === 'false') {
        return next(new InvalidArgumentError('%s is inactive. ' +
                    'Must use an active package', req.params['package']));
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

    opts.owner_uuid = customer;

    return req.sdc.vmapi.createVm(opts, function (err, vm) {
        if (err) {
            return next(err);
        }

        // vm coming from createVM is merely vm_uuid, job_uuid:
        return req.sdc.vmapi.getVm({
            uuid: vm.vm_uuid,
            owner_uuid: customer
        }, function (err1, machine) {
            if (err1) {
                return next(err1);
            }
            machine = translate(machine, req.params.credentials, req.datasets);
            // Cache machine as a res member, so it can be used from
            // postProvision plugins.
            res.machine = machine;
            res.header('Location', sprintf(
                    '/%s/machines/%s', login, machine.id));
            log.debug('GetMachine(/%s/%s) => %j', customer, name, machine);
            res.send(201, machine);
            return next();

        });
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
            _machines.push(translate(m, req.params.credentials, req.datasets));
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

    return req.sdc.vmapi.getVm({
        uuid: name,
        owner_uuid: customer
    }, function (err, machine) {
        if (err) {
            return next(err);
        }

        machine = translate(machine, req.params.credentials, req.datasets);

        log.debug('GetMachine(%s/%s) => %j', customer, name, machine);
        res.send((machine.state === 'deleted' ? 410 : 200), machine);
        return next();
    });
}


function start(req, res, next) {
    if (req.params.action !== 'start') {
        return next();
    }

    return req.sdc.vmapi.startVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid
    }, updateCallback(req, res, next));
}


function stop(req, res, next) {
    if (req.params.action !== 'stop') {
        return next();
    }

    return req.sdc.vmapi.stopVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid
    }, updateCallback(req, res, next));
}


function reboot(req, res, next) {
    if (req.params.action !== 'reboot') {
        return next();
    }

    return req.sdc.vmapi.rebootVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid
    }, updateCallback(req, res, next));
}


function resize(req, res, next) {
    if (req.params.action !== 'resize') {
        return next();
    }
    // Don't let the user resize to the default
    if (!req.pkg) {
        if (req.params['package']) {
            return next(new InvalidArgumentError('%s is not a valid package',
                                                 req.params['package']));
        }
        return next(new MissingParameterError('package must be specified'));
    }

    if (req.pkg.active === 'false') {
        return next(new InvalidArgumentError('%s is inactive. ' +
                    'Must use an active package', req.params['package']));
    }

    var callback = updateCallback(req, res, next),
        params = {
            uuid: req.params.machine,
            owner_uuid: req.account.uuid,
            'package': req.pkg.uuid,
            max_physical_memory: req.pkg.max_physical_memory,
            ram: req.pkg.max_physical_memory,
            max_swap: req.pkg.max_swap,
            quota: req.pkg.quota,
            cpu_cap: req.pkg.cpu_cap,
            max_lwps: req.pkg.max_lwps,
            zfs_io_priority: req.pkg.zfs_io_priority,
            vcpus: req.pkg.vcpus,
            package_name: req.pkg.name,
            package_version: req.pkg.version,
            billing_id: req.pkg.uuid
        };

    // PUBAPI-444: Trying to figure out where do we have the missing resize
    // params happening just some times, found it was due to missing package
    // on random cases. If we don't have a package to resize loaded, we rather
    // fail early.
    req.log.info({
        request_params: req.params,
        req_pkg: req.pkg,
        params: params
    }, 'updateVm resize params');

    if (!req.pkg) {
        return next(new InternalError('Unable to load the requested package'));
    }
    return req.sdc.vmapi.updateVm(params, callback);
}


function rename(req, res, next) {
    if (req.params.action !== 'rename') {
        return next();
    }

    if (!req.params.name) {
        return next(new MissingParameterError('New name must be specified'));
    }

    return req.sdc.vmapi.updateVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid,
        alias: req.params.name
    }, updateCallback(req, res, next));
}


function del(req, res, next) {
    var customer = req.account.uuid,
        machine = req.params.machine,
        log = req.log;

    return req.sdc.vmapi.deleteVm({
        uuid: machine,
        owner_uuid: customer
    }, function (err) {
        if (err) {
            return next(err);
        }

        log.debug('rm %s/%s successful', req.account.login, machine);
        res.send(204);
        return next();
    });
}


/**
 * Note @param {Array} pre and @param {Array} post can be
 * undefined when there aren't pre or post provision hooks enabled for the
 * configured plugins.
 */
function mount(server, before, pre, post) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.post(
        {
            path: '/:account/machines',
            name: 'CreateMachine'
        },
        before,
        pre || [],
        imageToDataset,
        ensureDataset,
        ensurePackage,
        checkPassword,
        loadSSHKeys,
        create,
        post || []);

    // The update handlers all check "should I run?" and if they should,
    // the chain stops.  To handle the case where the user specified a bogus
    // action
    server.post(
        {
            path: '/:account/machines/:machine',
            name: 'UpdateMachine',
            version: '6.5.0'
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

    server.post(
        {
            path: '/:account/machines/:machine',
            name: 'UpdateMachine',
            version: '7.0.0'
        },
        before,
        rename,
        start,
        stop,
        reboot,
        resize,
        function invalidAction7(req, res, next) {
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
