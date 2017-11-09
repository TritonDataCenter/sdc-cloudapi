/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * This module implements endpoints for the features described in [RFD
 * 26](https://github.com/joyent/rfd/blob/master/rfd/0026/README.md). These
 * endpoints make use of the VOLAPI internal core service, whose implementation
 * is available at http://github.com/joyent/sdc-volapi.
 */

var assert = require('assert-plus');
var jsprim = require('jsprim');
var krill = require('krill');
var restify = require('restify');
var util = require('util');
var vasync = require('vasync');
var VError = require('verror');

var errors = require('../errors');
var mod_networks = require('../networks');
var predicateValidation = require('../validation/predicate');
var volumesValidation = require('../validation/volumes');

var DefaultFabricNetworkNotConfiguredError =
    errors.DefaultFabricNetworkNotConfiguredError;

// NOTE: This function also exists in sdc-volapi lib/endpoints/volumes.js
//       someday the two should probably be merged into a library.
function checkInvalidParams(params, validParamNames) {
    assert.object(params, 'params');
    assert.arrayOfString(validParamNames, 'validParamNames');

    var errs = [];
    var paramName;

    for (paramName in params) {
        if (!params.hasOwnProperty(paramName)) {
            continue;
        }

        if (validParamNames.indexOf(paramName) === -1) {
            errs.push(new Error('invalid parameter: ' + paramName));
        }
    }

    return errs;
}

function validateGetVolumeInput(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var validationErr = volumesValidation.validateVolumeId(req.params.id);

    if (validationErr) {
        next([validationErr]);
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

        res.send(200, translateVolumeFromVolApi(volume));

        next();
    });
}

//
// NOTE: This will add the 'listVolumesPredicate' property to the 'req' object
// if req.params.predicate can be turned into a valid predicate.
//
function validateListVolumesInput(req, res, next) {
    assert.object(req, 'req');
    assert.object(req.params, 'req.params');
    assert.object(req.query, 'req.query');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var invalidParamsErrs;
    var latestErr;
    var predFields;
    var reqParams = req.params;
    var validationErrs = [];
    var VALID_PARAM_NAMES = [
        'name',
        'predicate',
        'size',
        'state',
        'type'
    ];

    // Use req.query since that doesn't include 'account' which comes from the
    // URL rather than query parameters.
    invalidParamsErrs = checkInvalidParams(req.query, VALID_PARAM_NAMES);
    validationErrs = validationErrs.concat(invalidParamsErrs);

    if (reqParams.name !== undefined) {
        latestErr =
            volumesValidation.validateVolumeNameSearchParam(reqParams.name);
        if (latestErr) {
            validationErrs.push(latestErr);
        }
    }

    if (reqParams.type !== undefined) {
        latestErr = volumesValidation.validateVolumeType(reqParams.type);
        if (latestErr) {
            validationErrs.push(latestErr);
        }
    }

    if (reqParams.size !== undefined) {
        latestErr =
            volumesValidation.validateVolumeSizeSearchParam(reqParams.size);
        if (latestErr) {
            validationErrs.push(latestErr);
        }
    }

    if (reqParams.state !== undefined) {
        latestErr = volumesValidation.validateVolumeState(reqParams.state);
        if (latestErr) {
            validationErrs.push(latestErr);
        }
    }

    if (reqParams !== undefined && reqParams.predicate !== undefined) {
        latestErr =
            predicateValidation.validatePredicate(reqParams.predicate);
        if (latestErr) {
            validationErrs.push(latestErr);
        } else {
            req.listVolumesPredicate =
                krill.createPredicate(JSON.parse(reqParams.predicate));

            predFields = req.listVolumesPredicate.fields();
            predFields.forEach(function validatePredField(field) {
                if (reqParams[field] !== undefined &&
                    reqParams[field] !== null) {

                    // we have both query parameter and predicate field, invalid
                    validationErrs.push(new Error('predicate has "' + field
                        + '" which conflicts with parameter with same name'));
                }
            });
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
    assert.object(req.params, 'req.params');
    assert.object(req.query, 'req.query');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var listVolumesParams = {
        owner_uuid: req.account.uuid
    };
    var parsedPredicate;
    var queryParamFields = Object.keys(req.query);

    if (req.params.predicate !== undefined) {
        // req.listVolumesPredicate must have been set in
        // validateListVolumesInput
        assert.object(req.listVolumesPredicate, 'req.listVolumesPredicate');

        parsedPredicate = req.listVolumesPredicate;

        if (parsedPredicate.fields().indexOf('id') !== -1) {
            parsedPredicate = parsedPredicate.replaceFields({id: 'uuid'});
        }

        listVolumesParams.predicate = JSON.stringify(parsedPredicate.p_pred);
    } else if (req.params.state === undefined) {
        // PUBAPI-1371: When we have no state and no predicate, we should
        // filter out failed volumes.
        listVolumesParams.predicate = JSON.stringify({
            ne: ['state', 'failed']
        });
    }

    // We already validated in validateListVolumesInput that this only contains
    // legitimate parameters, so add them to the listVolumesParams now.
    queryParamFields.forEach(function addParam(field) {
        if (field === 'predicate') {
            // we already added predicate above if set
            return;
        }

        listVolumesParams[field] = req.query[field];
    });

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

        res.send(200, volumes.map(translateVolumeFromVolApi));

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

function validateListVolumeSizesInput(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var validationErr;

    if (req.params.type !== undefined) {
        validationErr = volumesValidation.validateVolumeType(req.params.type);
    }

    next(validationErr);
}

function listVolumeSizes(req, res, next) {
    assert.object(req, 'req');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var listVolumeSizesParams = {};

    if (req.params.type !== undefined) {
        listVolumeSizesParams.type = req.params.type;
    }

    req.sdc.volapi.listVolumeSizes(listVolumeSizesParams, {
        log: req.log,
        headers: {
            'x-request-id': req.getId()
        }
    }, function onListVolumeSizes(listVolumeSizesErr, volumeSizes) {
        if (listVolumeSizesErr) {
            next(listVolumeSizesErr);
            return;
        }

        assert.arrayOfObject(volumeSizes, 'volumeSizes');

        res.header('x-query-limit', req.limit);
        res.header('x-resource-count', volumeSizes.length);

        res.send(200, volumeSizes);

        next();
    });
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
                return;
            }

            log.info({
                dataCenterName: req.config.datacenter_name,
                accountUuid: req.account.uuid
            }, 'Getting default fabric network...');

            mod_networks.getDefaultFabricNetworkForUser(req.sdc.ufds,
                req.config.datacenter_name,
                req.account, {
                    log: log
                },
                function onGetNetwork(getNetworkErr, network) {
                    var err;

                    if (getNetworkErr) {
                        log.error({
                            err: getNetworkErr
                        }, 'Error when getting default fabric network');
                    } else {
                        log.info({
                            network: network
                        }, 'Retrieved default fabric network successfully');
                    }

                    if (network !== undefined) {
                        ctx.networks = [network.uuid];
                    } else {
                        err = new DefaultFabricNetworkNotConfiguredError(
                            getNetworkErr);
                    }

                    done(err);
                });
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

                ctx.createdVolume = volume;
                done(exposedErr);
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

        assert.object(context.createdVolume, 'ctx.createdVolume');
        res.send(201, translateVolumeFromVolApi(context.createdVolume));
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

        res.send(204);
        next();
    });
}

function validateUpdateVolumeInput(req, res, next) {
    assert.object(req, 'req');
    assert.object(req.params, 'req.params');
    assert.object(req.query, 'req.query');
    assert.object(res, 'res');
    assert.func(next, 'next');

    var latestErr;
    var paramName;
    var validationErrs = [];
    var VALID_PARAM_NAMES = ['account', 'name'];

    if (req.params.name !== undefined) {
        latestErr = volumesValidation.validateVolumeName(req.params.name);
        if (latestErr) {
            validationErrs.push(latestErr);
        }
    }

    latestErr = volumesValidation.validateVolumeId(req.params.id);

    if (latestErr) {
        validationErrs.push(latestErr);
    }

    for (paramName in req.query) {
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

            /*
             * We purposedly do _not_ render the updated volume, as we would
             * need to either:
             *
             * 1. render the original volume, which is not useful when we try to
             *    update (change) it.
             *
             * 2. render the result of the update, which would require to load
             *    the volume object from moray, adding more latency to the
             *    request's response.
             *
             * Instead, we reply with a 204 HTTP status code (no content) and
             * clients can send a GetVolume request if/when they want to get the
             * representation of the modified volume.
             */
            res.send(204);
            next();
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

function mountVolumesEndpoints(server, beforeHandler) {
    assert.object(server, 'server');
    assert.func(beforeHandler, 'beforeHandler');

    server.get({
        path: '/:account/volumesizes',
        name: 'ListVolumeSizes'
    },
    beforeHandler,
    validateListVolumeSizesInput,
    listVolumeSizes);

    server.get({
        path: '/:account/volumes/:id',
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
        path: '/:account/volumes/:id',
        name: 'DeleteVolume'
    },
    beforeHandler,
    validateDeleteVolumeInput,
    deleteVolume);

    server.post({
        path: '/:account/volumes/:id',
        name: 'UpdateVolume'
    },
    beforeHandler,
    validateUpdateVolumeInput,
    updateVolume);
}

module.exports = {
    mount: mountVolumesEndpoints
};
