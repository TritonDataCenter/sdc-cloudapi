/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

/* BEGIN JSSTYLED */
/*
 * Triton's *affinity rules* support (i.e. the rules/hints for deciding to what
 * server a new instance is provisioned). We parse the affinity strings that
 * Cloudapi and Docker understand and convert them into the affinity
 * representation that DAPI uses, which is passed to vmapi's CreateMachine
 * endpoint.
 *
 * A source motivation of Triton affinity rules was the affinity features that
 * Docker Swarm provides with its "affinity" container filters, described here:
 *      https://docs.docker.com/swarm/scheduler/filter/#how-to-write-filter-expressions
 * The other Swarm filters are ignored. See DOCKER-630 for discussion.
 *
 * # Affinity types
 *
 * There are three affinity axes in the Swarm docs:
 *
 * - *container affinity*: Specify to land on the same or different server
 *   as an existing instances/containers.
 *      docker run -e affinity:container==db0 ...
 *      docker run --label 'com.docker.swarm.affinities=["container==db0"]' ...
 *      triton create -a instance==db0 ...
 *
 * - *label affinity*: Specify to land on the same or different server as
 *   existing containers with a given label key/value.
 *      docker run --label role=webhead ...     # the starter container
 *      docker run -e affinity:role==webhead ...
 *      docker run --label 'com.docker.swarm.affinities=["role==webhead"]' ...
 *      triton create -a role=webhead ...
 *
 * - *image affinity*: Specify to land on a node with the given image.
 *      docker run -e affinity:image==redis ...
 *      docker run --label 'com.docker.swarm.affinities=["image==redis"]' ...
 *   Note: We will skip this one. For Triton an image is present on all nodes
 *   in the DC. Until a possible future when Triton acts as a Swarm master
 *   for multiple DCs, the semantics of this affinity don't apply.
 *
 * # Limitations
 *
 * - Affinity rules using the '==' operator and that match *multiple instances
 *   on separate CNs*: sdc-designation must select just *one* of those multiple
 *   instances.
 *
 *   E.g. 'instance==webhead*' when there are "webhead0" and "webhead1"
 *   instances on separate CNs. There is no way to provision an instance that
 *   is on *both* CNs. The intention is to select webhead0's server *or*
 *   webhead1's server. However, locality hints don't support "or".
 *   Therefore the affinity->locality translation must select just one.
 *
 *   The issue is that the translation doesn't know which one might be more
 *   appropriate -- e.g. webhead0's server might be out of space.
 *
 * - sdc-designation's currently cannot handle mixed strict and non-strict
 *   rules. E.g.:
 *      docker run -e affinity:container==db0 -e 'affinity:container!=db1' ...
 *   Currently we just drop the non-strict rules when hitting this. An
 *   alternative would be to error out.
 */
/* END JSSTYLED */

var assert = require('assert-plus');
var vasync = require('vasync');
var VError = require('verror');


// ---- globals

var EXPR_KEY_RE = /^[a-z_][a-z0-9\-_.]+$/i;

/*
 * Expression values can have the following chars:
 * - alphanumeric: a-z, A-Z, 0-9
 * - plus any of the following characters: `-:_.*()/?+[]\^$|`
 *
 * The Swarm docs and code do not agree, so it is hard to divine the intent
 * other than "pretty loose".
 *
 * Dev Note: This regex differs from the Swarm one in expr.go to fix some issues
 * (e.g. it looks to me like Swarm's regex usage is in error that it allows
 * a leading `=` because the surrounding parsing code parses out the full
 * operator already) and accomodate slight parsing differences (e.g. this code
 * parses off a leading `~` or `!` or `=` from the operator before using this
 * regex).
 */
// JSSTYLED
var EXPR_VALUE_RE = /^[-a-z0-9:_\s.*/()?+[\]\\^$|]+$/i;


// ---- internal support stuff


/**
 * Parse an affinity rule expression.
 *
 * Our "affinity expression" is the equivalent of a Swarm filter expression.
 * https://github.com/docker/swarm/blob/ee28008f/scheduler/filter/expr.go
 *
 * The underlined part is the rule/expression:
 *
 *      docker run -e affinity:container==db0 ...
 *                             ^^^^^^^^^^^^^^
 *      docker run --label 'com.docker.swarm.affinities=["container==db0"]' ...
 *                                                        ^^^^^^^^^^^^^^
 *
 * A parsed affinity rule is an object like this:
 *      {
 *          key: '<the key string>',        // e.g. 'container', 'instance'
 *          operator: <'==' or '!='>,
 *          value: '<the value string>',
 *          isSoft: <true or false>,
 *          valueType: <'exact', 'glob' or 're'>
 *      }
 *
 * @throws {VError} with name 'ValidationError' if a given rule string
 *      is invalid.
 */
function ruleFromExpr(s) {
    assert.string(s, 's');

    var i;
    var rule = {};
    var op;
    var opIdx;
    var OPERATORS = ['==', '!='];

    // Determine which operator was used.
    for (i = 0; i < OPERATORS.length; i++) {
        opIdx = s.indexOf(OPERATORS[i]);
        if (opIdx !== -1) {
            op = OPERATORS[i];
            break;
        }
    }

    if (!op) {
        throw new VError({name: 'ValidationError'},
            'could not find operator in affinity rule: '
            + 'expected one of "%s": %j', OPERATORS.join('", "'), s);
    }

    // Build the rule.
    rule.key = s.slice(0, opIdx);
    if (!EXPR_KEY_RE.test(rule.key)) {
        throw new VError({name: 'ValidationError'},
            'invalid key in affinity rule: %j: %j does not match %s',
            s, rule.key, EXPR_KEY_RE);
    }
    rule.operator = op;
    rule.value = s.slice(opIdx + rule.operator.length);
    if (rule.value.length > 0 && rule.value[0] === '~') {
        rule.isSoft = true;
        rule.value = rule.value.slice(1);
    } else {
        rule.isSoft = false;
    }
    if (!EXPR_VALUE_RE.test(rule.value)) {
        throw new VError({name: 'ValidationError'},
            'invalid value in affinity rule: %j: %j does not match %s',
            s, rule.value, EXPR_VALUE_RE);
    }
    if (rule.value.length >= 3 && rule.value[0] === '/' &&
        rule.value[rule.value.length - 1] === '/')
    {
        rule.valueType = 're';
    } else if (rule.value.indexOf('*') !== -1) {
        rule.valueType = 'glob';
    } else {
        rule.valueType = 'exact';
    }

    return rule;
}


// ---- exports


/*
 * Convert the given `affinity` (as accepted by CloudAPI's CreateMachine) to
 * a `affinity` object as supported by sdc-designation (aka DAPI).
 *
 * @param ...
 * @param {Function} cb: `function (err, locality, debugInfo)`
 *      where `debugInfo` is an object with a `rulesInfo` field that shows
 *      internal details. The caller may want to log this.
 */
function parseAffinity(opts, cb) {
    assert.arrayOfString(opts.affinity, 'opts.affinity');
    assert.func(cb, 'cb');

    var affinity = opts.affinity;

    if (affinity.length === 0) {
        cb();
        return;
    }

    try {
        // TODO: improve this to get all parse errors and VError.errorFromList.
        var rules = affinity.map(ruleFromExpr);
    } catch (exprErr) {
        cb(exprErr);
        return;
    }

    cb(null, rules);
}


module.exports = {
    parseAffinity: parseAffinity
};
