// Copyright 2013 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var util = require('util');

var restify = require('restify');
var uuid = require('node-uuid');
var clone = require('clone');

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


function KeyRequiredError() {

    var message = 'At least one SSH key is required to provision';

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
    case 'failed':
        state = 'failed';
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
        image: machine.image_uuid,
        ips: [],
        memory: machine.ram,
        disk: (parseInt(machine.quota, 10) * 1024) || 0,
        metadata: machine.customer_metadata || {},
        'package': (machine.package_name) ?
                                machine.package_name : '',
        tags: machine.tags,
        credentials: credentials,
        created: machine.create_timestamp || '',
        updated: machine.last_modified || ''
    }, dataset;

    if (msg.type === 'virtualmachine' && machine.disks[0]) {
        msg.image = machine.disks[0].image_uuid;
    }

    datasets = datasets.filter(function (d) {
        return (d.uuid === machine.image_uuid || (
            machine.brand === 'kvm' &&
            d.uuid === machine.disks[0].image_uuid));
    });

    if (datasets.length) {
        dataset = datasets[0];
        msg.dataset = dataset.urn;
    }

    if (machine.nics && machine.nics.length) {
        machine.nics.forEach(function (nic) {
            msg.ips.push(nic.ip);
        });

        msg.primaryIp = machine.nics.reduce(function (acc, nic) {
            return (nic.nic_tag === 'external') ? nic.ip : acc;
        }, '');
    }

    if (credentials) {
        if (msg.metadata.credentials) {
            if (typeof (msg.metadata.credentials) === 'string') {
                try {
                    msg.metadata.credentials =
                        JSON.parse(msg.metadata.credentials);
                } catch (e) {}
            }

            Object.keys(msg.metadata.credentials).forEach(function (k) {
                if (!/_pw$/.test(k)) {
                    msg.metadata.credentials[k.replace(/_pw$/, '')] =
                        msg.metadata.credentials[k];
                    delete msg.metadata.credentials[k];
                }
            });
        }
    } else {
        if (msg.metadata.credentials) {
            delete msg.metadata.credentials;
        }
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
        opts.state = 'active';
        break;
    case 'stopping':
        opts.state = 'active';
        break;
    case 'active':
        opts.state = 'active';
        break;
    case 'stopped':
        opts.state = 'stopped';
        break;
    case 'running':
        opts.state = 'running';
        break;
    case 'unknown':
        opts.state = 'unknown';
        break;
    case 'destroyed':
        opts.state = 'destroyed';
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
    if (!req.params.tombstone && !opts.state) {
        opts.state = 'active';
    }

    return opts;
}


function getCreateOptions(req) {
    assert.ok(req);
    var brand;

    if (req.dataset.requirements && req.dataset.requirements.brand) {
        brand = req.dataset.requirements.brand;
    } else {
        brand = (req.dataset.brand) ? req.dataset.brand :
                (req.dataset.type === 'zvol') ? 'kvm' : 'joyent';
    }

    var opts = {
        'package': req.pkg.uuid,
        ram: req.pkg.max_physical_memory,
        brand: brand,
        package_name: req.pkg.name,
        package_version: req.pkg.version,
        billing_id: req.pkg.uuid
    };

    if (brand === 'kvm') {
        opts.disks = [
            { image_uuid: req.dataset.uuid },
            { size: parseInt(req.pkg.quota, 10) }
        ];
    } else {
        opts.image_uuid = req.dataset.uuid;
        opts.image_os = req.dataset.os;
        opts.image_name = req.dataset.name;
    }

    if (req.params.networks && !/6\.5/.test(req.getVersion())) {
        opts.networks = req.params.networks;
    } else {
        if (typeof (req.pkg.networks) === 'string') {
            try {
                req.pkg.networks = JSON.parse(req.pkg.networks);
            } catch (e) {
                // Do nothing on JSON.parse error
            }
        }
        opts.networks = (req.pkg.networks) ? req.pkg.networks : req.nets;
    }

    var metadata = {};
    var tags = {};

    var users = [];
    if (req.dataset.generate_passwords && req.dataset.users) {
        req.dataset.users.forEach(function (u) {
            users.push(u.name);
        });
    }

    opts.alias = req.params.name || uuid().replace(/-/, '').substr(0, 7);

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

    // Windows administrator password:
    if (req.params.password) {
        metadata.administrator_pw = req.params.password;
    }

    if (req.params.administrator_pw) {
        metadata.administrator_pw = req.params.administrator_pw;
    }

    // root_authorized_keys right place:
    if (req.root_authorized_keys) {
        metadata.root_authorized_keys = req.root_authorized_keys;
    }

    if (typeof (metadata.credentials) === 'string') {
        try {
            metadata.credentials = JSON.parse(metadata.credentials);
        } catch (e) {}
    }
    // Check users, and ensure we're taking passwords either when they are
    // specified as '<user>_pw' or simply with the respective user names:
    if (metadata.credentials) {
        Object.keys(metadata.credentials).forEach(function (k) {
            if (!/_pw$/.test(k)) {
                metadata.credentials[k + '_pw'] = metadata.credentials[k];
                delete metadata.credentials[k];
            }
        });
    }

    // Ensure we pass a string to VMAPI, not an object, or validation will fail
    if (metadata.credentials) {
        metadata.credentials = JSON.stringify(metadata.credentials);
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
    // Another alternative to provide server_uuid, (which I mostly use
    // locally to run node-smartdc tests w/o having to hardcode server_uuid
    // into sdc-createmachine):
    if (process.env.SERVER_UUID) {
        opts.server_uuid = process.env.SERVER_UUID;
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


function loadMachine(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid,
        name = req.params.machine;

    return req.sdc.vmapi.getVm({
        uuid: name,
        owner_uuid: customer
    }, function (err, machine) {
        if (err) {
            return next(err);
        }

        req.machine = translate(machine, req.params.credentials, req.datasets);
        return next();
    });
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
        if (!req.params.password && !req.params.administrator_pw) {
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
            return next(new KeyRequiredError());
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

    var customer = req.account.uuid;
    var log = req.log;
    var login = req.account.login;
    var name = req.params.machine;
    var opts = getCreateOptions(req);

    // If trying to provision using a network not provisionable by user,
    // fail early instead of queue and wait for the job to do:
    if (req.networks && opts.networks) {
        req.network_uuids = req.networks.map(function (n) {
            return (n.uuid);
        });
        var forbiddenNetwork = opts.networks.some(function verifyNetworks(net) {
            return (req.network_uuids.indexOf(net) === -1);
        });

        if (forbiddenNetwork) {
            return next(new InvalidArgumentError('Invalid Networks'));
        }
    }

    opts.owner_uuid = customer;
    // Audit:
    opts.context = {
        caller: req._auditCtx,
        params: req.params
    };

    return req.sdc.vmapi.createVm(opts, function (err, vm) {
        if (err) {
            return next(err);
        }

        // FIXME: for SDC7.next do this with backoff module.
        // cloudapi's vmapi client is way faster than moray
        return setTimeout(function () {
            // vm coming from createVM is merely vm_uuid, job_uuid:
            return req.sdc.vmapi.getVm({
                uuid: vm.vm_uuid,
                owner_uuid: customer
            }, function (err1, machine) {
                if (err1) {
                    return next(err1);
                }
                machine = translate(machine, req.params.credentials,
                                    req.datasets);
                // Cache machine as a res member, so it can be used from
                // postProvision plugins.
                res.machine = machine;
                res.header('Location', sprintf(
                        '/%s/machines/%s', login, machine.id));
                log.debug('GetMachine(/%s/%s) => %j', customer, name, machine);
                res.send(201, machine);
                return next();

            });
        }, 200);
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var opts = getListOptions(req);

    opts.owner_uuid = customer;
    // Advanced search, to allow searching any tagged machine (note this
    // overrides any other option):
    if (req.params.tags && req.params.tags === '*') {
        opts = {
            query: '(&(owner_uuid=' + customer + ')(tags=*))'
        };
    }

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
    // Already preloaded by loadMachine:
    log.debug('GetMachine(%s/%s) => %j', customer, name, req.machine);
    res.send((req.machine.state === 'deleted' ? 410 : 200), req.machine);
    return next();
}


function start(req, res, next) {
    if (req.params.action !== 'start') {
        return next();
    }

    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
        return next();
    }

    return req.sdc.vmapi.startVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid,
        // Audit:
        context: {
            caller: req._auditCtx,
            params: req.params
        }
    }, updateCallback(req, res, next));
}


function stop(req, res, next) {
    if (req.params.action !== 'stop') {
        return next();
    }

    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
        return next();
    }

    return req.sdc.vmapi.stopVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid,
        // Audit:
        context: {
            caller: req._auditCtx,
            params: req.params
        }
    }, updateCallback(req, res, next));
}


function reboot(req, res, next) {
    if (req.params.action !== 'reboot') {
        return next();
    }

    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
        return next();
    }

    return req.sdc.vmapi.rebootVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid,
        // Audit:
        context: {
            caller: req._auditCtx,
            params: req.params
        }
    }, updateCallback(req, res, next));
}


function resize(req, res, next) {
    if (req.params.action !== 'resize') {
        return next();
    }

    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
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
            quota: Math.ceil(Number(req.pkg.quota) / 1024),
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
    // Audit:
    params.context = {
        caller: req._auditCtx,
        params: req.params
    };
    return req.sdc.vmapi.updateVm(params, callback);
}


function rename(req, res, next) {
    if (req.params.action !== 'rename') {
        return next();
    }

    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
        return next();
    }

    if (!req.params.name) {
        return next(new MissingParameterError('New name must be specified'));
    }

    return req.sdc.vmapi.updateVm({
        uuid: req.params.machine,
        owner_uuid: req.account.uuid,
        alias: req.params.name,
        // Audit:
        context: {
            caller: req._auditCtx,
            params: req.params
        }
    }, updateCallback(req, res, next));
}


function del(req, res, next) {
    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
        return next();
    }

    var customer = req.account.uuid,
        machine = req.params.machine,
        log = req.log;

    var r = {
        path: sprintf('/vms/%s?owner_uuid=%s', machine, customer),
        headers: {
            'x-joyent-context': JSON.stringify({
                caller: req._auditCtx,
                params: req.params
            })
        }
    };
    return req.sdc.vmapi.client.del(r, function (err, req1, res1) {
        if (err) {
            return next(err);
        }

        log.debug('rm %s/%s successful', req.account.login, machine);
        res.send(204);
        return next();
    });
}


function usage(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var name = req.params.machine;
    var period = req.params.period;

    if (!period.match(/^[0-9]{4}-[0-9]{1,2}$/)) {
        return next(new InvalidArgumentError(
                'period (string, YYYY-MM) required'));
    }

    if (req.machine.state === 'deleted') {
        res.send(410, req.machine);
        return next();
    }

    var begin = new Date(period);
    var end = clone(begin);
    var finish = new Date(end.setMonth(end.getMonth() + 1));

    var opt = {
        start: begin.toISOString(),
        finish: finish.toISOString(),
        vms: name,
        owners: customer
    };

    return req.sdc.usageapi.getReport(opt, function (er1, report) {
        if (er1) {
            // Either the report does not exists, and we need to generate, or
            // there's something else going on:
            if (er1.statusCode === 404) {
                return req.sdc.usageapi.generateReport(opt, function (er2, l) {
                    if (er2) {
                        return next(er2);
                    }
                    log.warn(l);
                    res.send(204, {status: 'queued', report: {}});
                    return next();
                });
            } else {
                return next(er1);
            }
        } else {
            log.debug('GetMachineReport(%s/%s) => %j', customer, name, report);
            res.send((report.status !== 'done' ? 204 : 200), report);
            return next();
        }
    });
}


function getRuleMachines(req, res, next) {
    assert.ok(req.sdc);

    var customer = req.account.uuid;
    var log = req.log;
    var id = req.params.id;
    var fwapi = req.sdc.fwapi;

    return fwapi.getRuleVMs(id, {
        owner_uuid: customer
    }, function (err, machines) {
        if (err) {
            return next(err);
        }
        var _machines = [];
        machines.forEach(function (m) {
            _machines.push(translate(m, req.params.credentials, req.datasets));
        });

        res.header('x-resource-count', _machines.length);
        log.debug('GET %s => %j', req.path(), _machines);
        res.send(_machines);
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
        pre || [],
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
            name: 'UpdateMachine65',
            version: ['6.5.0', '6.5.1', '6.5.2', '6.5.3', '6.5.4', '6.5.5']
        },
        before,
        loadMachine,
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
        loadMachine,
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


    server.get({
        path: '/:account/fwrules/:id/machines',
        name: 'GetRuleMachines'
    }, before, getRuleMachines);

    server.head({
        path: '/:account/fwrules/:id/machines',
        name: 'HeadRuleMachines'
    }, before, getRuleMachines);

    server.get(
        {
            path: '/:account/machines/:machine',
            name: 'GetMachine'
        },
        before,
        loadMachine,
        get);

    server.head(
        {
            path: '/:account/machines/:machine',
            name: 'HeadMachine'
        },
        before,
        loadMachine,
        get);

    server.get(
        {
            path: '/:account/machines/:machine/usage/:period',
            name: 'GetMachineUsage'
        },
        before,
        loadMachine,
        usage);

    server.del(
        {
            path: '/:account/machines/:machine',
            name: 'DeleteMachine'
        },
        before,
        loadMachine,
        del);

    return server;
}


///--- Exports

module.exports = {
    mount: mount
};
