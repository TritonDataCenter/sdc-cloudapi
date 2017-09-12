/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

// TODO: This should move to a separate `triton-affinity` module shared by
// sdc-docker and sdc-cloudapi.

/* BEGIN JSSTYLED */
/*
 * Triton's *affinity rules* support (i.e. the rules/hints for deciding to what
 * server a new instance is provisioned).
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
 * # Affinities -> Locality Hints
 *
 * Triton's current feature for a VM creation providing affinity is "locality
 * hints". As a first pass we'll be translating given affinity expressions
 * (in Docker, via both the '-e' envvar syntax and the newer '--label' syntax;
 * and in CloudAPI, via the 'affinity' param to CreateMachine) to Triton's
 * "locality hints". See here for the locality hints big-theory comment and
 * implementation:
 *      https://github.com/joyent/sdc-designation/blob/master/lib/algorithms/soft-filter-locality-hints.js
 *
 * # Limitations
 *
 * - DOCKER-1039 is a known issue: Hard affinity rules using instance names or
 *   tags for concurrent provisions will race. The correct fix for that (to
 *   handle the translation from instance name/tags to UUIDs in DAPI's
 *   server selection -- which is serialized in the DC) will fix the issue for
 *   both sdc-docker and CloudAPI.
 *
 * - sdc-designation's locality hints cannot handle mixed strict and non-strict
 *   rules. E.g.:
 *      docker run -e affinity:container==db0 -e 'affinity:container!=db1' ...
 *   To support that we'd need to extend the "locality" data structure format.
 *   Currently we just drop the non-strict rules when hitting this. An
 *   alternative would be to error out.
 */
/* END JSSTYLED */

var assert = require('assert-plus');
var format = require('util').format;
var strsplit = require('strsplit');
var vasync = require('vasync');
var VError = require('verror');
var XRegExp = require('xregexp');


// ---- globals

var FILTER_KEY_RE = /^[a-z_][a-z0-9\-_.]+$/i;

/*
 * Filter values can have the following chars:
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
var FILTER_VALUE_RE = /^[-a-z0-9:_\s.*/()?+[\]\\^$|]+$/i;


// ---- internal support stuff


function _isUuid(str) {
    var re = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
    if (str && str.length === 36 && str.match(re)) {
        return true;
    } else {
        return false;
    }
}


/*
 * This is a copy of `dockerIdToUuid` from sdc-docker.git:
 *  https://github.com/joyent/sdc-docker/blob/94fa554d/lib/common.js#L537-L547
 * to determine a Triton VM UUID from a Docker container ID.
 */
function dockerIdToUuid(dockerId) {
    var out;

    out = dockerId.substr(0, 8) + '-'
        + dockerId.substr(8, 4) + '-'
        + dockerId.substr(12, 4) + '-'
        + dockerId.substr(16, 4) + '-'
        + dockerId.substr(20, 12);

    return (out);
}


/**
 * Parse out affinity rules from a Docker container config.
 *
 * Compare to Swarm's processing for pulling from Env and Labels,
 * storing `Labels['com.docker.swarm.affinities']`:
 *    https://github.com/docker/swarm/blob/4ff0b10/cluster/config.go
 *
 * *Side-Effect*:
 * - This removes 'affinity:*' entries from `container.Env`.
 * - If affinity expressions are provided in `container.Env` then
 *   `container.Labels['com.docker.swarm.affinities']` is updated with them.
 *
 * @throws {VError} with name 'ValidationError' if a given affinity label or
 *      envvar is invalid.
 */
function _affinityRulesFromDockerContainer(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.container, 'opts.container');

    var exprs = [];

    // Labels, e.g.: { 'com.docker.swarm.affinities': '["a==b"]' }
    var labels = opts.container.Labels;
    if (labels && labels['com.docker.swarm.affinities']) {
        exprs = exprs.concat(_affinityExprsFromDockerLabel(
            labels['com.docker.swarm.affinities']));
    }

    // Env, e.g.: [ 'affinity:foo==bar' ]
    var env = opts.container.Env;
    var envIdxToDel = [];
    var i, kv, parts;
    if (env) {
        for (i = 0; i < env.length; i++) {
            kv = env[i];
            if (kv.slice(0, 9) === 'affinity:') {
                parts = strsplit(kv, ':', 2);
                exprs.push(parts[1]);
                envIdxToDel.push(i);
            }
        }
    }

    // Parse the rules/expressions.
    var rules = [];
    for (i = 0; i < exprs.length; i++) {
        rules.push(_ruleFromExpr(exprs[i]));
    }

    // Side-effects.
    if (envIdxToDel.length > 0) {
        envIdxToDel.reverse().forEach(function (idx) {
            opts.container.Env.splice(idx, 1);
        });
        labels['com.docker.swarm.affinities'] = JSON.stringify(exprs);
    }

    return rules;
}


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
 *          valueType: <'exact', 'glob' or 're'>,
 *          valueRe: <RegExp for `value`>   // only defined if valueType==='re'
 *      }
 *
 * @throws {VError} with name 'ValidationError' if a given rule string
 *      is invalid.
 */
function _ruleFromExpr(s) {
    var rule = {};
    var operators = ['==', '!='];
    // JSL doesn't like a `return` in a `for`-loop.
    // jsl:ignore
    for (var i = 0; i < operators.length; i++) {
        // jsl:end
        var idx = s.indexOf(operators[i]);
        if (idx === -1) {
            continue;
        }
        rule.key = s.slice(0, idx);
        if (!FILTER_KEY_RE.test(rule.key)) {
            throw new VError({name: 'ValidationError'},
                'invalid key in affinity rule: %j: %j does not match %s',
                s, rule.key, FILTER_KEY_RE);
        }
        rule.operator = operators[i];
        rule.value = s.slice(idx + rule.operator.length);
        if (rule.value.length > 0 && rule.value[0] === '~') {
            rule.isSoft = true;
            rule.value = rule.value.slice(1);
        } else {
            rule.isSoft = false;
        }
        if (!FILTER_VALUE_RE.test(rule.value)) {
            throw new VError({name: 'ValidationError'},
                'invalid value in affinity rule: %j: %j does not match %s',
                s, rule.value, FILTER_VALUE_RE);
        }
        if (rule.value.length >= 3 && rule.value[0] === '/'
            && rule.value[rule.value.length - 1] === '/')
        {
            rule.valueType = 're';
            rule.valueRe = XRegExp(rule.value.slice(1, -1));
        } else if (rule.value.indexOf('*') !== -1) {
            rule.valueType = 'glob';
        } else {
            rule.valueType = 'exact';
        }
        return rule;
    }
    throw new VError({name: 'ValidationError'},
        'could not find operator in affinity rule: '
        + 'expected one of %s: %j', operators.join(', '), s);
}

function _exprFromRule(rule) {
    return format('%s%s%s%s', rule.key, rule.operator, rule.isSoft ? '~' : '',
        rule.value);
}

/**
 * Parse affinity expressions from a `docker run` "com.docker.swarm.affinities"
 * label.
 *
 * @throws {VError} with name 'ValidationError' if there is an error parsing.
 */
function _affinityExprsFromDockerLabel(label) {
    assert.string(label, 'label');

    var exprs;
    try {
        exprs = JSON.parse(label);
    } catch (parseErr) {
        throw new VError({name: 'ValidationError'},
            'invalid affinities label: %j: %s', label, parseErr);
    }

    if (!Array.isArray(exprs)) {
        throw new VError({name: 'ValidationError'},
            'affinities label is not an array: ' + label);
    }

    return exprs;
}


/*
 * Find the VM(s) matching the given affinity rule (parsed by _ruleFromExpr).
 *
 * If `affinity.key` is one of "container" or "instance" (*), the affinity value
 * can be any of:
 * - instance uuid: use that directly
 * - docker id: if at least a 32-char prefix of a docker_id,
 *   then can construct instance UUID from that and use that
 *   directly
 * - short docker id: look up all docker containers by uuid
 * - name: lookup all (not just docker) instances by alias
 * - name glob: lookup all (not just docker) instances by alias
 *   IIUC, Swarm's impl. is just simple globbing: '*'-only
 * - name regex: lookup all (not just docker) containers by
 *   alias.
 *
 * (*) "container" is required for Docker compat. "instance" is the external
 *     language that Triton now attempts to use, despite the continued use
 *     of "machine" in cloudapi code (e.g. see node-triton). It is perhaps
 *     debatable that we'd want to accept "inst" (node-triton does) and
 *     "machine". I'm inclined to *not*. This is a case of less (fewer options)
 *     is more: less confusion, less namespace pollution for tag names.
 *
 * Otherwise `affinity.key` is a tag key:
 * Find any VMs matching that key/value. As above, the value can be an exact
 * value (stringified comparison), glob (simple '*'-only glob) or regex.
 *
 * Dev Note: Annoyingly Triton prefixes docker labels with "docker:label:" on
 * VM.tags. So we search both. Note that this can look obtuse or ambiguious
 * to the docker user if a container has both 'foo' and 'docker:label:foo'
 * VM tags.
 *
 * @param {Object} opts.rule - The parsed affinity rule object.
 * @param {Object} opts.log
 * @param {UUID} opts.ownerUuid
 * @param {Object} opts.vmapi
 * @param {Object} opts.cache: Used to cache data for repeated calls to this
 *      function, e.g., for a single `localityFromDockerContainer` call.
 * @param {Function} cb: `function (err, vmUuids)`
 */
function _vmUuidsFromAffinityRule(opts, cb) {
    assert.object(opts.rule, 'opts.rule');
    assert.object(opts.log, 'opts.log');
    assert.uuid(opts.ownerUuid, 'opts.ownerUuid');
    assert.object(opts.vmapi, 'opts.vmapi');
    assert.object(opts.cache, 'opts.cache');
    assert.func(cb, 'cb');

    var rule = opts.rule;
    var i;
    var keyIsInst = (rule.key === 'instance' || rule.key === 'container');
    var log = opts.log;
    var query;
    var vm;
    var vms;

    var headers = {};
    if (log.fields.req_id) {
        headers['x-request-id'] = log.fields.req_id;
    }

    // A caching version of VMAPI 'ListVms?state=active&owner_uuid=$ownerUuid'.
    var getAllActiveVms = function (vmsCb) {
        if (opts.cache.allActiveVms) {
            vmsCb(null, opts.cache.allActiveVms);
            return;
        }
        opts.vmapi.listVms({
            fields: 'uuid,alias,internal_metadata,docker',
            owner_uuid: opts.ownerUuid,
            state: 'active'
        }, {
            headers: headers
        }, function (err, allActiveVms) {
            if (err) {
                vmsCb(err);
            } else {
                opts.cache.allActiveVms = allActiveVms;
                vmsCb(null, allActiveVms);
            }
        });
    };


    // $tag=$value
    // $tag=$glob
    if (!keyIsInst && rule.valueType !== 're') {
        query = {
            fields: 'uuid,alias,tags',
            owner_uuid: opts.ownerUuid,
            state: 'active',
            predicate: JSON.stringify({
                or: [
                    {eq: ['tag.' + rule.key,              rule.value]},
                    {eq: ['tag.docker:label:' + rule.key, rule.value]}
                ]
            })
        };
        opts.vmapi.listVms(query, {
            headers: headers
        }, function (err, vms_) {
            if (err) {
                cb(err);
                return;
            }
            log.trace({expr: _exprFromRule(rule), vms: vms_},
                '_vmUuidsFromAffinityRule');
            var vmUuids = vms_.map(function (vm_) { return vm_.uuid; });
            cb(null, vmUuids);
        });

    // $tag==/regex/
    // Get a all '$key=*'-tagged VMs and post-filter with `valueRe`.
    } else if (!keyIsInst && rule.valueType === 're') {
        query = {
            fields: 'uuid,alias,tags',
            owner_uuid: opts.ownerUuid,
            state: 'active',
            predicate: JSON.stringify({
                or: [
                    {eq: ['tag.' + rule.key,              '*']},
                    {eq: ['tag.docker:label:' + rule.key, '*']}
                ]
            })
        };
        opts.vmapi.listVms(query, {
            headers: headers
        }, function (err, allVms) {
            if (err) {
                cb(err);
                return;
            }
            vms = [];
            for (i = 0; i < allVms.length; i++) {
                vm = allVms[i];

                var tag = vm.tags[rule.key];
                if (tag !== undefined && rule.valueRe.test(tag.toString())) {
                    // Docker labels can only be strings. Triton VM tags can
                    // also be booleans or numbers.
                    vms.push(vm);
                    continue;
                }
                var label = vm.tags['docker:label:' + rule.key];
                if (label !== undefined && rule.valueRe.test(label)) {
                    vms.push(vm);
                    continue;
                }
            }
            log.trace({expr: _exprFromRule(rule), vms: vms},
                '_vmUuidsFromAffinityRule');
            var vmUuids = vms.map(function (vm_) { return vm_.uuid; });
            cb(null, vmUuids);
        });

    // instance==UUID
    } else if (_isUuid(rule.value)) {
        assert.ok(keyIsInst, 'key is "container" or "instance": ' + rule.key);
        cb(null, [rule.value]);

    // instance==<full 64-char docker id>
    //
    // Given a full 64-char docker id, Docker-docker will skip container
    // *name* matching (at least that's what containers.js#findContainerIdMatch
    // implies). We'll do the same here. Any other length means we need to
    // consider name matching.
    } else if (/^[a-f0-9]{64}$/.test(rule.value)) {
        assert.ok(keyIsInst, 'key is "container" or "instance": ' + rule.key);
        var vmUuid = dockerIdToUuid(rule.value);
        opts.vmapi.getVm({
            uuid: vmUuid,
            owner_uuid: opts.ownerUuid,
            fields: 'uuid,alias,state,internal_metadata,docker'
        }, {
            headers: headers
        }, function (err, vm_) {
            if (err && err.statusCode !== 404) {
                cb(err);
            } else if (!err && vm_ && vm_.docker
                && ['destroyed', 'failed'].indexOf(vm_.state) === -1
                && vm_.internal_metadata['docker:id'] === rule.value)
            {
                cb(null, [vmUuid]);
            } else {
                cb(null, []);
            }
        });

    // instance=<name>
    // instance=<short docker id>
    // instance=<name glob> (simple '*'-globbing only)
    // instance=<name regex>
    //
    // List all active VMs (non-docker too) and pass to "containers.js"
    // filter function to select a match.
    } else {
        assert.ok(keyIsInst, 'key is "container" or "instance": ' + rule.key);

        vms = [];
        vasync.pipeline({funcs: [
            /*
             * First attempt an exact name (aka alias) match as a quick out,
             * if possible.
             */
            function attemptNameMatch(_, next) {
                if (rule.valueType !== 'exact' && rule.valueType !== 'glob') {
                    next();
                    return;
                }

                opts.vmapi.listVms({
                    fields: 'uuid,alias',
                    owner_uuid: opts.ownerUuid,
                    state: 'active',
                    predicate: JSON.stringify({
                        eq: ['alias', rule.value] // this supports simple glob
                    })
                }, {
                    headers: headers
                }, function (err, vms_) {
                    if (err) {
                        next(err);
                    } else {
                        vms = vms_;
                        next();
                    }
                });
            },

            function fullVmListSearch(_, next) {
                if (vms.length) {
                    // Already got results.
                    next();
                    return;
                }

                getAllActiveVms(function (err, allVms) {
                    if (err) {
                        next(err);
                        return;
                    }

                    switch (rule.valueType) {
                    case 're':
                        // Regex is only on container name, not id.
                        for (i = 0; i < allVms.length; i++) {
                            vm = allVms[i];
                            if (vm.alias && rule.valueRe.test(vm.alias)) {
                                vms.push(vm);
                            }
                        }
                        next();
                        break;
                    case 'glob':
                        // Glob is only on container name, not id.
                        var valueRe = new RegExp(
                            '^' + XRegExp.escape(rule.value) + '$');
                        for (i = 0; i < allVms.length; i++) {
                            vm = allVms[i];
                            if (vm.alias && valueRe.test(vm.alias)) {
                                vms.push(vm);
                            }
                        }
                        next();
                        break;
                    case 'exact':
                        /*
                         * This is a exact name match (preferred) or id prefix.
                         * If there are multiple id-prefix matches, we'll
                         * raise an ambiguity error.
                         */
                        var exactErr;
                        var idPrefixMatches = [];
                        var nameMatch;
                        for (i = 0; i < allVms.length; i++) {
                            vm = allVms[i];
                            if (vm.alias && vm.alias === rule.value) {
                                nameMatch = vm;
                                break;
                            }
                            if (vm.docker
                                && vm.internal_metadata['docker:id']
                                && vm.internal_metadata['docker:id'].indexOf(
                                    rule.value) === 0)
                            {
                                idPrefixMatches.push(vm);
                            }
                        }
                        if (nameMatch) {
                            vms.push(nameMatch);
                        } else if (idPrefixMatches.length > 1) {
                            exactErr = new VError({
                                name: 'AmbiguousDockerContainerIdPrefixError',
                                info: {
                                    idPrefix: rule.value,
                                    idPrefixMatches: idPrefixMatches
                                }
                            }, 'id prefix "%s" matches multiple containers',
                            rule.value);
                        } else if (idPrefixMatches.length === 1) {
                            vms.push(idPrefixMatches[0]);
                        }
                        next(exactErr);
                        break;
                    default:
                        next(new VError('unknown affinity rule valueType: '
                            + rule.valueType));
                        break;
                    }
                });
            }
        ]}, function (err) {
            if (err) {
                cb(err);
            } else {
                log.trace({expr: _exprFromRule(rule), vms: vms},
                    '_vmUuidsFromAffinityRule');
                var vmUuids = vms.map(function (vm_) { return vm_.uuid; });
                cb(null, vmUuids);
            }
        });
    }
}


// ---- exports

/**
 * Calculate "locality" hints for a VMAPI CreateVm payload from Docker Swarm
 * "Env" and "Labels" affinity entries, if any, in a "docker run" API call.
 *
 * *Side-effects*:
 * - This *removes* affinity entries from `container.Env`.
 * - If affinities are provided in `container.Env` then
 *   `container.Labels['com.docker.swarm.affinities']` is updated with them.
 * Docker Swarm does the same.
 *
 * Swarm affinities can identify containers by id, id-prefix, name, name glob,
 * name regex, or via tag matches. They looks like the following:
 *      container<op><value>
 *      <tag><op><value>
 * where <op> is one of `==`, `!=`, `==~`, or `!=~` (`~` means a "soft"
 * affinity -- non-fatal if cannot match); and <value> can be a plain string
 * (exact match), a glob (simple '*'-only globbing), or a regexp (re2 syntax).
 * E.g.:
 *      container==1a8dae2f-d352-4340-8122-ae76b70a47bd
 *      container==1a8dae2fd352
 *      container!=db0
 *      container==db*
 *      container==/^db\d+$/
 *      flav!=staging
 *      role==/^web/
 *
 * Locality hints only speak VM uuids. They look like the following (all
 * fields are optional):
 *      {
 *          strict: <true|false>,
 *          near: [<array of VM uuids>],
 *          far: [<array of VM uuids>]
 *      }
 *
 * Looking up VMs in VMAPI is necessary for the translation.
 * Some failure modes:
 * - VMAPI requests could fail.
 * - No VMs could be found matching the filter, and the affinity is
 *   a strict '=='. (If we didn't fail, then we'd end up setting no `
 *   locality` and the strict affinity would be blithely ignored.)
 *
 * @param {Function} cb: `function (err, locality)` called back with one of:
 *      `err` is an Error instance if there was a problem; or err and locality
 *      not set if there were no rules; or `locality` is set to a
 *      locality hints object per the sdc-designation spec.
 */
function localityFromDockerContainer(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.vmapi, 'opts.vmapi');
    assert.uuid(opts.ownerUuid, 'opts.ownerUuid');
    assert.object(opts.container, 'opts.container');
    assert.func(cb, 'cb');

    var log = opts.log;

    try {
        var rules = _affinityRulesFromDockerContainer(opts);
    } catch (affErr) {
        cb(affErr);
        return;
    }
    if (rules.length === 0) {
        cb();
        return;
    }
    log.trace({rules: rules}, 'localityFromDockerContainer: rules');

    _localityFromRules({
        log: log,
        vmapi: opts.vmapi,
        ownerUuid: opts.ownerUuid,
        rules: rules
    }, cb);
}

/*
 * Convert the given `affinity` (as accepted by CloudAPI's CreateMachine) to
 * a `locality` object supported by sdc-designation (aka DAPI).
 */
function localityFromAffinity(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.vmapi, 'opts.vmapi');
    assert.uuid(opts.ownerUuid, 'opts.ownerUuid');
    assert.arrayOfString(opts.affinity, 'opts.affinity');
    assert.func(cb, 'cb');

    var log = opts.log;

    if (opts.affinity.length === 0) {
        cb();
        return;
    }

    var rules;
    try {
        // TODO: improve this to get all parse errors and VError.errorFromList.
        rules = opts.affinity.map(function (expr) {
            return _ruleFromExpr(expr);
        });
    } catch (exprErr) {
        cb(exprErr);
        return;
    }
    log.trace({rules: rules}, 'localityFromAffinity: rules');

    _localityFromRules({
        log: log,
        vmapi: opts.vmapi,
        ownerUuid: opts.ownerUuid,
        rules: rules
    }, cb);
}


function _localityFromRules(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.vmapi, 'opts.vmapi');
    assert.uuid(opts.ownerUuid, 'opts.ownerUuid');
    assert.arrayOfObject(opts.rules, 'opts.rules');
    assert.func(cb, 'cb');

    var log = opts.log;
    var rules = opts.rules;

    /**
     * Limitation: sdc-designation's soft-filter-locality-hints.js can't
     * handle mixed hard (strict) and soft (non-strict) affinity rules. However,
     * as long as affinity rules are just mean a specific server or not, we
     * can effectively handle this by dropping soft affinity rules if there
     * are hard ones.
     */
    var haveHard = false;
    var haveSoft = false;
    var softRules = [];
    var hardRules = [];
    for (var i = 0; i < rules.length; i++) {
        var isSoft = rules[i].isSoft;
        if (isSoft) {
            haveSoft = true;
            softRules.push(rules[i]);
        } else {
            haveHard = true;
            hardRules.push(rules[i]);
        }
    }
    if (haveHard && haveSoft) {
        log.trace({softRules: softRules},
            'mixed hard and soft affinity rules: dropping soft affinity rules');
        rules = hardRules;
    }

    var strict = haveHard;
    var near = [];
    var far = [];

    // TODO: Really want forEachParallel with concurrency.
    var cache = {};
    vasync.forEachPipeline({
        inputs: rules,
        func: function setLocalityFromRule(rule, next) {
            if (rule.key === 'image') {
                // TODO: Should we allow 'image' tag here?
                log.trace({rule: rule}, 'ignore "image" affinity');
                next();
            } else {
                _vmUuidsFromAffinityRule({
                    rule: rule,
                    log: log,
                    ownerUuid: opts.ownerUuid,
                    vmapi: opts.vmapi,
                    cache: cache
                }, function (err, vmUuids) {
                    if (err) {
                        next(err);
                    } else if (vmUuids.length === 0) {
                        /*
                         * Either we drop the affinity or error out. If
                         * it is a strict '==', then we need to error out
                         * (no server will match). If it is non-strict, or
                         * '!=', then we are fine dropping the affinity.
                         *
                         * See some discussion in DAPI-306.
                         */
                        if (!strict || rule.operator === '!=') {
                            log.trace({affinity: rule},
                                'drop affinity, no matching vms');
                            next();
                        } else if (rule.key !== 'container'
                                && rule.key !== 'instance') {
                            next(new VError({
                                name: 'ResourceNotFoundError'
                            }, 'no active instances found matching tag '
                                + '"%s=%s" for affinity "%s"',
                            rule.key, rule.value, _exprFromRule(rule)));
                        } else {
                            next(new VError({
                                name: 'ResourceNotFoundError'
                            }, 'no active instances found matching "%s" '
                                + 'for affinity "%s"',
                            rule.value, _exprFromRule(rule)));
                        }
                    } else {
                        if (rule.operator === '==') {
                            near = near.concat(vmUuids);
                        } else {
                            far = far.concat(vmUuids);
                        }
                        next();
                    }
                });
            }
        }
    }, function (err) {
        if (err) {
            cb(err);
        } else if (!near.length && !far.length) {
            cb();
        } else {
            var locality = {
                strict: strict
            };
            if (near.length > 0) locality.near = near;
            if (far.length > 0) locality.far = far;
            cb(null, locality);
        }
    });
}


module.exports = {
    localityFromDockerContainer: localityFromDockerContainer,
    localityFromAffinity: localityFromAffinity
};
