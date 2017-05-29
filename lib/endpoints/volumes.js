/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var jsprim = require('jsprim');
var restify = require('restify');
var util = require('util');
var vasync = require('vasync');

var errors = require('../errors');
var mod_networks = require('../networks');
var volumesValidation = require('../validation/volumes');

function validateGetVolumeInput(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var validationErrs = [];
    var latestErr;

    latestErr = volumesValidation.validateVolumeId(req.params.id);
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
        uuid: req.params.id
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

        req.responseVolume = volume;
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

    if (req.params.predicate) {
        listVolumesParams.predicate = req.params.predicate;
    } else if (!req.params.state) {
        // PUBAPI-1371: When we have no state and no predicate, we should
        // filter out failed volumes.
        listVolumesParams.predicate = JSON.stringify({
            ne: ['state', 'failed']
        });
    }

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

        req.responseVolumes = volumes;

        next();
    });
}

function validateCreateVolumeInput(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var latestErr;
    var validationErrs = [];

    latestErr = volumesValidation.validateVolumeName(req.params.name,
        {allowEmpty: true});
    if (latestErr) {
        validationErrs.push(latestErr);
    }

    latestErr = volumesValidation.validateVolumeType(req.params.type);
    if (latestErr) {
        validationErrs.push(latestErr);
    }

    if (req.params.size !== undefined) {
        latestErr = volumesValidation.validateVolumeSize(req.params.size);
        if (latestErr) {
            validationErrs.push(latestErr);
        }
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
                networks: ctx.networks,
                size: req.params.size
            };

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
        if (volCreationErr) {
            req.log.error({
                err: volCreationErr
            }, 'Error when creating volume');
            next(volCreationErr);
            return;
        }

        req.responseVolume = results.operations[1].result;
        next();
    });
}

function validateDeleteVolumeInput(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var latestErr;
    var validationErrs = [];

    latestErr = volumesValidation.validateVolumeId(req.params.id);
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
        uuid: req.params.id
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
    var VALID_PARAM_NAMES = [ 'account', 'id', 'name'];

    if (req.params.name) {
        latestErr = volumesValidation.validateVolumeName(req.params.name);
        if (latestErr) {
            validationErrs.push(latestErr);
        }
    }

    latestErr = volumesValidation.validateVolumeId(req.params.id);

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
        uuid: req.params.id,
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

            next(exposedErr);
        });
}

function translateVolumeFromVolApi(volapiVolume) {
    assert.object(volapiVolume, 'volapiVolume');

    var cloudApiVolume = jsprim.deepCopy(volapiVolume);

    cloudApiVolume.id = cloudApiVolume.uuid;
    delete cloudApiVolume.uuid;

    /*
     * The fact that a tritonnfs volume is associated with a storage VM is
     * considered to be an implementation detail that is irrelevant to end
     * users.
     */
    delete cloudApiVolume.vm_uuid;

    return cloudApiVolume;
}

function renderVolume(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    assert.object(req.responseVolume, 'req.responseVolume');

    req.renderedResponse = translateVolumeFromVolApi(req.responseVolume);
    next();
}

function renderVolumes(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    assert.object(req.responseVolumes, 'req.responseVolumes');

    req.renderedResponse = req.responseVolumes.map(translateVolumeFromVolApi);
    next();
}

function makeSendResponseHandler(options) {
    assert.object(options, 'options');

    var statusCode = options.statusCode || 200;

    return function sendResponseHandler(req, res, next) {
        assert.optionalObject(req.renderedResponse, 'req.renderedResponse');

        res.send(statusCode, req.renderedResponse);
        next();
    };
}

function renderEmptyObject(req, res, next) {
    req.renderedResponse = {};
    next();
}

function mountVolumesEndpoints(server, beforeHandler) {
    assert.object(server, 'server');
    assert.func(beforeHandler, 'beforeHandler');

    server.get({
        path: '/:account/volumes/:id',
        name: 'GetVolume'
    },
    beforeHandler,
    validateGetVolumeInput,
    getVolume,
    renderVolume,
    makeSendResponseHandler({
        statusCode: 200
    }));

    server.get({
        path: '/:account/volumes',
        name: 'ListVolumes'
    },
    beforeHandler,
    validateListVolumesInput,
    listVolumes,
    renderVolumes,
    makeSendResponseHandler({
        statusCode: 200
    }));

    server.post({
        path: '/:account/volumes',
        name: 'CreateVolume'
    },
    beforeHandler,
    validateCreateVolumeInput,
    createVolume,
    renderVolume,
    makeSendResponseHandler({
        statusCode: 201
    }));

    server.del({
        path: '/:account/volumes/:id',
        name: 'DeleteVolume'
    },
    beforeHandler,
    validateDeleteVolumeInput,
    deleteVolume,
    /*
     * Sending an empty body is required for haproxy to forward the
     * response.
     */
    renderEmptyObject,
    makeSendResponseHandler({
        statusCode: 204
    }));

    server.post({
        path: '/:account/volumes/:id',
        name: 'UpdateVolume'
    },
    beforeHandler,
    validateUpdateVolumeInput,
    updateVolume,
    /*
     * Sending an empty body is required for haproxy to forward the
     * response.
     */
    renderEmptyObject,
    /*
     * We purposedly do _not_ render the updated volume, as we would need to
     * either:
     *
     * 1. render the original volume, which is not useful when we try to update
     * (change) it.
     *
     * 2. render the result of the update, which would require to load the
     * volume object from moray, adding more latency to the request's response.
     *
     * Instead, we reply with a 204 HTTP status code (no content) and clients
     * can send a GetVolume request if/when they want to get the representation
     * of the modified volume.
     */
    makeSendResponseHandler({
        statusCode: 204
    }));
}

module.exports = {
    mount: mountVolumesEndpoints
};
