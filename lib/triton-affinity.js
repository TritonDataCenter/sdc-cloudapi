/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

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
 *   tags for *concurrent provisions* will race. The correct fix for that (to
 *   handle the translation from instance name/tags to UUIDs in DAPI's
 *   server selection -- which is serialized in the DC) will fix the issue for
 *   both sdc-docker and CloudAPI.
 *
 * - Affinity rules using the '==' operator and that match *multiple instances
 *   on separate CNs*: the translation to locality hints must select just
 *   *one* of those multiple instances.
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

function setIntersection(a, b) {
    var intersection = new Set();
    a.forEach(function (elem) {
        if (b.has(elem)) {
            intersection.add(elem);
        }
    });
    return intersection;
}

function setJoin(set, sep) {
    var arr = [];
    set.forEach(function (elem) {
        arr.push(elem);
    });
    return arr.join(sep);
}


function setRandomChoice(set) {
    var idx = Math.floor(Math.random() * set.size);
    var choice;
    set.forEach(function (elem) {
        if (idx === 0) {
            choice = elem;
        }
        idx--;
    });
    assert.ok(choice !== undefined);
    return choice;
}

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
    assert.optionalObject(opts.container.Labels, 'opts.container.Labels');
    assert.optionalArrayOfString(opts.container.Env, 'opts.container.Env');

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
        rules.push(ruleFromExpr(exprs[i]));
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
        rule.valueRe = XRegExp(rule.value.slice(1, -1));
    } else if (rule.value.indexOf('*') !== -1) {
        rule.valueType = 'glob';
    } else {
        rule.valueType = 'exact';
    }

    return rule;
}

function exprFromRule(rule) {
    assert.object(rule, 'rule');
    assert.string(rule.key, 'rule.key');
    assert.string(rule.operator, 'rule.operator');
    assert.bool(rule.isSoft, 'rule.isSoft');
    assert.string(rule.value, 'rule.value');

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
 * Find the VM(s) matching the given affinity rule (parsed by ruleFromExpr).
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
 * @param {Function} cb: `function (err, vms)`
 */
function _vmsFromRule(opts, cb) {
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
    function getAllActiveVms(vmsCb) {
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
        }, function onListAllVms(err, allActiveVms) {
            if (err) {
                vmsCb(err);
            } else {
                opts.cache.allActiveVms = allActiveVms;
                vmsCb(null, allActiveVms);
            }
        });
    }


    // $tag=$value
    // $tag=$glob
    if (!keyIsInst && rule.valueType !== 're') {
        query = {
            fields: 'uuid,alias,server_uuid,tags',
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
        }, function onListVmsMatchingTags(err, vms_) {
            if (err) {
                cb(err);
                return;
            }
            log.trace({expr: exprFromRule(rule), vms: vms_}, '_vmsFromRule');
            cb(null, vms_);
        });

    // $tag==/regex/
    // Get a all '$key=*'-tagged VMs and post-filter with `valueRe`.
    } else if (!keyIsInst && rule.valueType === 're') {
        query = {
            fields: 'uuid,alias,server_uuid,tags',
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
        }, function onListVmsForTagRegex(err, allVms) {
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
            log.trace({expr: exprFromRule(rule), vms: vms}, '_vmsFromRule');
            cb(null, vms);
        });

    // instance==UUID
    } else if (_isUuid(rule.value)) {
        assert.ok(keyIsInst, 'key is "container" or "instance": ' + rule.key);
        opts.vmapi.getVm({
            uuid: rule.value,
            owner_uuid: opts.ownerUuid,
            fields: 'uuid,alias,state,server_uuid'
        }, {
            headers: headers
        }, function onGetVm(err, vm_) {
            if (err) {
                cb(err);
            } else if (vm_ &&
                ['destroyed', 'failed'].indexOf(vm_.state) === -1) {
                cb(null, [vm_]);
            } else {
                cb(null, []);
            }
        });

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
            fields: 'uuid,alias,state,server_uuid,internal_metadata,docker'
        }, {
            headers: headers
        }, function onGetVmFromDockerId(err, vm_) {
            if (err && err.statusCode !== 404) {
                cb(err);
            } else if (!err && vm_ && vm_.docker &&
                ['destroyed', 'failed'].indexOf(vm_.state) === -1 &&
                vm_.internal_metadata['docker:id'] === rule.value)
            {
                cb(null, [vm_]);
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
                    fields: 'uuid,alias,server_uuid',
                    owner_uuid: opts.ownerUuid,
                    state: 'active',
                    predicate: JSON.stringify({
                        eq: ['alias', rule.value] // this supports '*'-glob
                    })
                }, {
                    headers: headers
                }, function onListVmsMatchingAlias(err, vms_) {
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

                getAllActiveVms(function onGetAllActiveVms(err, allVms) {
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
                        // Dev Note: Better would be to use minimatch.
                        var valueRe = new RegExp(
                            '^'
                            + XRegExp.escape(rule.value)
                                .replace('\\*', '.*')
                                .replace('\\?', '.')
                            + '$');
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
                            if (vm.docker &&
                                vm.internal_metadata['docker:id'] &&
                                vm.internal_metadata['docker:id'].indexOf(
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
        ]}, function onInstNameMatch(err) {
            if (err) {
                cb(err);
            } else {
                log.trace({expr: exprFromRule(rule), vms: vms}, '_vmsFromRule');
                cb(null, vms);
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
 * @param ...
 * @param {Function} cb: `function (err, locality, debugInfo)`
 *      where `debugInfo` is an object with a `rulesInfo` field that shows
 *      internal details. The caller may want to log this.
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
 *
 * @param ...
 * @param {Function} cb: `function (err, locality, debugInfo)`
 *      where `debugInfo` is an object with a `rulesInfo` field that shows
 *      internal details. The caller may want to log this.
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
            return ruleFromExpr(expr);
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

/*
 * Convert affinity rules to locality hints, as best as possible.
 *
 * @param ...
 * @param {Function} cb: `function (err, locality, debugInfo)`
 *      where `debugInfo` is an object with a `rulesInfo` field that shows
 *      internal details. The caller may want to log this.
 */
function _localityFromRules(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.vmapi, 'opts.vmapi');
    assert.uuid(opts.ownerUuid, 'opts.ownerUuid');
    assert.arrayOfObject(opts.rules, 'opts.rules');
    assert.func(cb, 'cb');

    var log = opts.log;
    log.trace({rules: opts.rules}, '_localityFromRules: rules');

    // First, gather VM info that we'll need for conversion.
    // TODO: Really want forEachParallel with concurrency.
    var cache = {};
    vasync.forEachParallel({
        inputs: opts.rules,
        func: function gatherVmsForRule(rule, next) {
            if (rule.key === 'image') {
                // TODO: Should we allow 'image' tag here?
                log.trace({rule: rule}, 'ignore "image" affinity');
                next();
                return;
            }

            _vmsFromRule({
                rule: rule,
                log: log,
                ownerUuid: opts.ownerUuid,
                vmapi: opts.vmapi,
                cache: cache
            }, function onVmsFromRule(err, vms) {
                rule.vms = vms;
                next(err);
            });
        }
    }, function onVmsFromRules(err) {
        if (err) {
            cb(err);
            return;
        }

        // Second, convert to locality hints.
        try {
            var locality = localityFromRulesInfo({
                log: log,
                rules: opts.rules
            });
        } catch (convertErr) {
            cb(convertErr);
            return;
        }

        log.trace({locality: locality}, '_localityFromRules: locality');
        cb(null, locality, {rulesInfo: opts.rules});
    });
}

/*
 * Synchronously convert affinity rules (and required extra info) to locality
 * hints, as best as possible.
 *
 * Dev Note: we separate "gather async details" and "convert rules -> locality"
 * steps to make the latter more easily testable.
 */
function localityFromRulesInfo(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    // Each rule object should have a 'vms' array. This code uses the 'uuid'
    // and (if not null) 'server_uuid' fields of each VM.
    assert.arrayOfObject(opts.rules, 'opts.rules');
    opts.rules.forEach(function (r) {
        assert.arrayOfObject(r.vms, 'opts.rules[*].vms');
        r.vms.forEach(function (v) {
            assert.ok(v.hasOwnProperty('uuid'));
            assert.ok(v.hasOwnProperty('server_uuid'));
        });
    });

    var i;
    var log = opts.log;
    var rules = opts.rules;
    log.trace({rules: rules}, 'localityFromRulesInfo: rules');

    var haveHard = false;
    var haveSoft = false;
    var softRules = [];
    var hardRules = [];
    for (i = 0; i < rules.length; i++) {
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

    var farServerUuids = new Set();
    var farRules = rules.filter(function (farRule) {
        return farRule.operator === '!=';
    });
    var farVmUuids = new Set();
    farRules.forEach(function (farRule) {
        farRule.vms.forEach(function (vm) {
            farVmUuids.add(vm.uuid);
            farServerUuids.add(vm.server_uuid);
        });
    });
    farVmUuids.forEach(function (farVmUuid) {
        far.push(farVmUuid);
    });

    // Work through each "near" rule.
    var nearRules = rules.filter(function (nearRule) {
        return nearRule.operator === '==';
    });
    var nearServerUuids = null; // Servers that satisfy all near rules.
    nearRules.forEach(function (nearRule) {
        if (nearRule.vms.length === 0) {
            if (isSoft) {
                nearRule.skip = true;
                return;
            } else {
                throw new VError('cannot satisfy affinity rule "%s", '
                    + 'it does not match any instances',
                    exprFromRule(nearRule));
            }
        }

        // Eliminate "far" servers from candidacy.
        nearRule.remainingVms = nearRule.vms.filter(function (vm) {
            // Provisioning VMs might not have a server_uuid.
            return (vm.server_uuid && !farServerUuids.has(vm.server_uuid));
        });

        // If there are no remaining VMs, then this rule is unsatisfiable.
        if (nearRule.remainingVms.length === 0) {
            if (isSoft) {
                nearRule.skip = true;
                return;
            } else {
                throw new VError('cannot satisfy affinity rule "%s", '
                    + '"!=" rules eliminate all its servers',
                    exprFromRule(nearRule));
            }
        }

        // Candidate servers are the intersection of servers for this rule
        // and those from previous rules.
        var ruleServerUuids = new Set(nearRule.remainingVms.map(
                function (vm) { return vm.server_uuid; }));
        if (nearServerUuids === null) {
            nearServerUuids = ruleServerUuids;
        } else {
            var newCandidates = setIntersection(
                nearServerUuids, ruleServerUuids);
            if (newCandidates.size === 0) {
                if (isSoft) {
                    nearRule.skip = true;
                    return;
                } else {
                    throw new VError('cannot satisfy affinity rule "%s", '
                        + 'its servers (%s) do not intersect with servers from '
                        + 'previous rules (%s)',
                        exprFromRule(nearRule),
                        setJoin(ruleServerUuids, ', '),
                        setJoin(nearServerUuids, ', '));
                }
            } else {
                nearServerUuids = newCandidates;
            }
        }
    });

    if (nearServerUuids !== null) {
        /*
         * If there are multiple candidate servers, then we must choose one
         * here (we choose at random). We can't pass through multiple servers
         * because you can't provision an instance on more than one server.
         * It would be better to send through all the candidates and have
         * sdc-designation choose the best of those servers (considering
         * available capacity, etc.), but locality hints don't support a
         * list of candidates.
         */
        assert.ok(nearServerUuids.size > 0);
        var serverUuid = setRandomChoice(nearServerUuids);

        /*
         * Locality hints speak in terms of VMs. We'll use the first VM from
         * the first non-skipped rule as the representative of `serverUuid`.
         */
        var vmUuid;
        for (i = 0; i < nearRules.length; i++) {
            var rule = nearRules[i];
            if (rule.skip) {
                continue;
            }
            for (var j = 0; j < rule.remainingVms.length; j++) {
                if (rule.remainingVms[j].server_uuid === serverUuid) {
                    vmUuid = rule.remainingVms[j].uuid;
                    break;
                }
            }
            if (vmUuid) {
                break;
            }
        }
        assert.ok(vmUuid);
        near.push(vmUuid);
    }


    var locality = {
        strict: strict
    };
    if (near.length > 0) {
        locality.near = near;
    }
    if (far.length > 0) {
        locality.far = far;
    }

    return locality;
}


module.exports = {
    localityFromDockerContainer: localityFromDockerContainer,
    localityFromAffinity: localityFromAffinity,

    // Exported for testing.
    localityFromRulesInfo: localityFromRulesInfo,
    ruleFromExpr: ruleFromExpr,
    exprFromRule: exprFromRule
};
