/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var krill = require('krill');
var VError = require('verror');

var volumesValidation = require('./volumes');

var VOLUME_PREDICATE_TYPES = {
    id: 'string',
    name: 'string',
    network: 'string',
    size: 'number',
    state: 'string',
    type: 'string'
};

function validatePredicate(predicateString) {
    assert.string(predicateString, 'predicateString');

    var predicateObject;
    var predicate;
    var validationErrs = [];
    var predicateFieldsAndValues;
    var predicateField;
    var VALIDATION_FUNCS = {
        id: volumesValidation.validateVolumeId,
        name: volumesValidation.validateVolumeName,
        network: volumesValidation.validateVolumeNetwork,
        size: volumesValidation.validateVolumeSize,
        state: volumesValidation.validateVolumeState,
        type: volumesValidation.validateVolumeType
    };

    try {
        predicateObject = JSON.parse(predicateString);
    } catch (parseErr) {
        return new VError(parseErr, 'Could not parse JSON predicate %s',
            predicateString);
    }

    try {
        predicate = krill.createPredicate(predicateObject,
            VOLUME_PREDICATE_TYPES);
    } catch (predicateValidationErr) {
        return predicateValidationErr;
    }

    predicateFieldsAndValues = predicate.fieldsAndValues();

    for (predicateField in predicateFieldsAndValues) {
        var validationFunc = VALIDATION_FUNCS[predicateField];
        var predicateValues = predicateFieldsAndValues[predicateField];

        assert.func(validationFunc, 'validationFunc');

        predicateValues.forEach(function validatePredicateValue(value) {
            var validationError = validationFunc(value);
            if (validationError) {
                validationErrs.push(validationError);
            }
        });
    }

    if (validationErrs.length > 0) {
        return new Error('Invalid values in predicate: ' + validationErrs);
    }

    return undefined;
}

module.exports = {
    validatePredicate: validatePredicate
};