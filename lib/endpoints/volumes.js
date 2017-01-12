/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var restify = require('restify');
var util = require('util');
var vasync = require('vasync');

var errors = require('../errors');
var mod_networks = require('../networks');
var mod_volumes = require('../volumes');
var volumesValidation = require('../validation/volumes');

function validateGetVolumeInput(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var validationErrs = [];
    var latestErr;

    latestErr = volumesValidation.validateVolumeUuid(req.params.uuid);
    if (latestErr) {
        validationErrs.push(latestErr);
    }

    if (validationErrs.length > 0) {
        next(validationErrs);
    } else {
        next();
    }
}

function getVolume(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var getVolumeParams = {
        owner_uuid: req.account.uuid,
        uuid: req.params.uuid
    };
    var log = req.log;

    req.sdc.volapi.getVolume(getVolumeParams, {
        log: req.log,
        headers: {
            'x-request-id': req.getId()
        }
    }, function onGetVolume(getVolumeErr, volume) {
        var exposedErr;

        if (getVolumeErr) {
            log.error({err: getVolumeErr}, 'Error when getting volume');
            exposedErr = new errors.volapiErrorWrap(getVolumeErr,
                'Error when getting volume');
            next(exposedErr);
            return;
        }

        res.send(volume);
        next();
    });
}

function validateListVolumesInput(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var validationErrs = [];
    var latestErr;

    if (req.params.name) {
        latestErr = volumesValidation.validateVolumeName(req.params.name);
        if (latestErr) {
            validationErrs.push(latestErr);
        }
    }

    if (req.params.type) {
        latestErr = volumesValidation.validateVolumeType(req.params.type);
        if (latestErr) {
            validationErrs.push(latestErr);
        }
    }

    if (validationErrs.length > 0) {
        next(new restify.InvalidArgumentError(validationErrs.join(', ')));
    } else {
        next();
    }
}

function listVolumes(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var listVolumesParams = {
        owner_uuid: req.account.uuid
    };

    req.sdc.volapi.listVolumes(listVolumesParams, {
        log: req.log,
        headers: {
            'x-request-id': req.getId()
        }
    }, function onListVolumes(listVolumesErr, volumes) {
        if (listVolumesErr) {
            next(listVolumesErr);
            return;
        }

        res.header('x-query-limit', req.limit);
        res.header('x-resource-count', volumes.length);
        res.send(volumes);

        next();
    });
}

function validateCreateVolumeInput(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var latestErr;
    var validationErrs = [];

    latestErr = volumesValidation.validateVolumeName(req.params.name);
    if (latestErr) {
        validationErrs.push(latestErr);
    }

    latestErr = volumesValidation.validateVolumeType(req.params.type);
    if (latestErr) {
        validationErrs.push(latestErr);
    }

    latestErr = volumesValidation.validateVolumeSize(req.params.size);
    if (latestErr) {
        validationErrs.push(latestErr);
    }

    latestErr = volumesValidation.validateVolumeNetworks(req.params.networks);
    if (latestErr) {
        validationErrs.push(latestErr);
    }

    if (validationErrs.length > 0) {
        next(new restify.InvalidArgumentError(validationErrs.join(', ')));
    } else {
        next();
    }
}

function createVolume(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var log = req.log;
    var context = {};

    vasync.pipeline({funcs: [
        function getNetworksFromParams(ctx, done) {
            if (req.params.networks !== undefined) {
                mod_networks.checkFabricNetworks(req.sdc.napi,
                    req.params.networks,
                    req.account.uuid,
                    function onFabricNetworksChecked(getFabricNetErr, valid) {
                        var checkFabricNetworkErr;
                        if (getFabricNetErr || !valid) {
                            checkFabricNetworkErr =
                                new restify.InvalidArgumentError('Invalid ' +
                                    'networks: ' + req.params.networks);
                        }

                        ctx.networks = req.params.networks;

                        done(checkFabricNetworkErr);
                    });
            } else {
                log.info({
                    dataCenterName: req.config.datacenter_name,
                    accountUuid: req.account.uuid
                }, 'Getting default fabric network...');
                mod_networks.getDefaultFabricNetworkForUser(req.sdc.ufds,
                    req.config.datacenter_name,
                    req.account.uuid,
                    function onGetNetwork(getNetworkErr, network) {
                        if (getNetworkErr) {
                            log.error({
                                err: getNetworkErr
                            }, 'Error when getting default fabric network');
                        } else {
                            log.info({
                                network: network
                            }, 'Retreived default fabric network successfully');
                        }

                        if (network !== undefined) {
                            ctx.networks = [network.uuid];
                        }

                        done(getNetworkErr);
                    });
            }
        },
        function _createVolume(ctx, done) {
            assert.arrayOfUuid(ctx.networks, 'ctx.networks');

            var createVolumeParams = {
                owner_uuid: req.account.uuid,
                name: req.params.name,
                type: req.params.type,
                networks: ctx.networks
            };

            /*
             * The "size" input parameter was validated by a previous restify
             * handler, so it's safe to call "parseVolumeSize" here, even though
             * it throws on invalid input.
             */
            createVolumeParams.size =
                mod_volumes.parseVolumeSize(req.params.size);

            req.sdc.volapi.createVolume(createVolumeParams, {
                log: req.log,
                headers: {
                    'x-request-id': req.getId()
                }
            }, function onVolCreated(volCreationErr, volume) {
                var exposedErr;

                if (volCreationErr) {
                    log.error({err: volCreationErr},
                        'Error when creating volume');
                    exposedErr = new errors.volapiErrorWrap(volCreationErr,
                        'Error when creating volume');
                }

                done(exposedErr, volume);
            });
        }
    ], arg: context
    }, function onVolumeCreationDone(volCreationErr, results) {
        var createdVolume;

        if (volCreationErr) {
            req.log.error({
                err: volCreationErr
            }, 'Error when creating volume');
            next(volCreationErr);
            return;
        }

        createdVolume = results.operations[1].result;
        assert.object(createdVolume, 'createdVolume');

        res.send(createdVolume);
        next();
    });
}

function validateDeleteVolumeInput(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var latestErr;
    var validationErrs = [];

    latestErr = volumesValidation.validateVolumeUuid(req.params.uuid);
    if (latestErr) {
        validationErrs.push(latestErr);
    }

    if (validationErrs.length > 0) {
        next(new restify.InvalidArgumentError(validationErrs.join(', ')));
    } else {
        next();
    }
}

function deleteVolume(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var deleteVolumeParams = {
        owner_uuid: req.account.uuid,
        uuid: req.params.uuid
    };
    var log = req.log;

    req.sdc.volapi.deleteVolume(deleteVolumeParams, {
        log: req.log,
        headers: {
            'x-request-id': req.getId()
        }
    }, function onVolumeDeleted(volDeletionErr) {
        var exposedErr;

        if (volDeletionErr) {
            log.error({err: volDeletionErr}, 'Error when deleting volume');
            exposedErr = new errors.volapiErrorWrap(volDeletionErr,
                'Error when deleting volume');
            next(exposedErr);
            return;
        }

        res.statusCode = 204;
        /*
         * Sending an empty body is required for haproxy to forward the
         * response.
         */
        res.send({});
        next();
    });
}

function validateUpdateVolumeInput(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var latestErr;
    var paramName;
    var validationErrs = [];
    var VALID_PARAM_NAMES = [ 'account', 'uuid', 'name'];

    if (req.params.name) {
        latestErr = volumesValidation.validateVolumeName(req.params.name);
        if (latestErr) {
            validationErrs.push(latestErr);
        }
    }

    latestErr = volumesValidation.validateVolumeUuid(req.params.uuid);

    if (latestErr) {
        validationErrs.push(latestErr);
    }

    for (paramName in req.params) {
        if (!req.params.hasOwnProperty(paramName)) {
            continue;
        }

        if (VALID_PARAM_NAMES.indexOf(paramName) === -1) {
            validationErrs.push(new restify.InvalidArgumentError(paramName +
                ' is an invalid parameter'));
        }
    }

    if (validationErrs.length > 0) {
        next(new restify.InvalidArgumentError(validationErrs.join(', ')));
    } else {
        next();
    }
}

function updateVolume(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    /*
     * We currently support updating only a volume's name. No other property can
     * be updated through the UpdateVolume endpoint. Other properties can (or
     * will be allowed to) be updated by using separate endpoints.
     */
    var updateVolumeParams = {
        owner_uuid: req.account.uuid,
        uuid: req.params.uuid,
        name: req.params.name
    };

    req.sdc.volapi.updateVolume(updateVolumeParams,
        function onVolUpdated(volUpdateErr, volume) {
            var exposedErr;

            if (volUpdateErr) {
                exposedErr = new errors.volapiErrorWrap(volUpdateErr,
                    'Error when updating volume');
                next(exposedErr);
                return;
            }

            res.send(200, volume);
            next(exposedErr);
        });
}

function mountVolumesEndpoints(server, beforeHandler) {
    assert.object(server, 'server');
    assert.func(beforeHandler, 'beforeHandler');

    server.get({
        path: '/:account/volumes/:uuid',
        name: 'GetVolume'
    },
    beforeHandler,
    validateGetVolumeInput,
    getVolume);

    server.get({
        path: '/:account/volumes',
        name: 'ListVolumes'
    },
    beforeHandler,
    validateListVolumesInput,
    listVolumes);

    server.post({
        path: '/:account/volumes',
        name: 'CreateVolume'
    },
    beforeHandler,
    validateCreateVolumeInput,
    createVolume);

    server.del({
        path: '/:account/volumes/:uuid',
        name: 'DeleteVolume'
    },
    beforeHandler,
    validateDeleteVolumeInput,
    deleteVolume);

    server.post({
        path: '/:account/volumes/:uuid',
        name: 'UpdateVolume'
    },
    beforeHandler,
    validateUpdateVolumeInput,
    updateVolume);
}

module.exports = {
    mount: mountVolumesEndpoints
};