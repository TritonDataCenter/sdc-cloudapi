/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * This applies provision & resize limits specified by operators across a
 * datacenter, either for all accounts or for a specific account. It is possible
 * to limit an account based on three sums: total number of account VMs, total
 * sum of those VMs' RAM, and/or the total sum of those VM's disk quota. Each of
 * these three sums can be optionally constrainted by: VM brand, VM OS
 * (specifically, the "os" attribute in the VM's image), and/or VM image name.
 *
 * Examples are worth a lot, so here are some examples of limits before going
 * into the specifics:
 *
 * { "value": 200,  "by": "quota" }
 * { "value": 1024, "by": "ram", "check": "os",    "os": "windows" }
 * { "value": 25 }
 * { "value": 100,               "check": "brand", "brand": "lx" }
 * { "value": 8192, "by": "ram", "check": "image", "image": "base64-lts" }
 * { "value": 50,                "check": "os",    "os": "any" }
 *
 * Now the specifics.
 *
 * Limit comes in the following JSON format:
 * { "value": <number> }
 *
 * Where <number> is either a number, or a 10-base string encoding of a number.
 * E.g. 10 or "10". 0 and -1 have special meanings: 0 means unlimited, and -1
 * prevents all matching provisions.
 *
 * By default, a limit counts the number of VMs across a datacenter. So to set
 * the maximum number of VMs for an account across a datacenter to 25, use:
 * { "value": 25 }
 *
 * We can modify what the "value" counts by adding a "by" clause:
 * { "value": <number>, "by": "<dimension>" }
 *
 * Where currently-supported dimensions are "ram" (in MiB) or "quota" (in GiB).
 * It's possible to use something beyond "ram" and "quota" (e.g. "count"), but
 * that will be ignored and treated as the default: counting the number of VMs
 * across a datacenter; this is for compatibility with cloudapi's old plugin.
 *
 * As an example, to limit the total amount of RAM an account can use across a
 * datacenter to 10240MiB, use the following limit:
 * { "value": 10240, "by": "ram" }
 *
 * It's possible to constrain a limit to specific VM brands, image names or
 * operating systems, instead of the entire datacenter. This is done with the
 * "check" attribute. It comes in three forms:
 * { ..., "check": "brand", "brand": "<VM brand>" }
 * { ..., "check": "image", "image": "<name of image>" }
 * { ..., "check": "os", "os": "<name of image operating system>" }
 *
 * So to limit the total amount of RAM used by VMs running Windows images to
 * 8192MiB:
 * { "value": 8192, "by": "ram", "check": "os", "os": "windows" }
 *
 * You can use "any" in place of the image OS or name, or the VM brand. Like so:
 * { "value" 25, "check": "image", "image": "any" }
 *
 * "any" flags in "image" or "os" are commonly added by adminui, yet while "any"
 * is supported, its effect is the same as not using "check" in the first place.
 * E.g. these two are equivalent, both limiting the amount of disk used across
 * an entire datacenter to 900GiB:
 * { "value": 900, "by": "quota", "check": "os", "os": "any" }
 * { "value": 900, "by": "quota" }
 *
 * Several limits can apply to the same account at once. All the examples above
 * were meant as one-liners, but adding several limits to an account will work
 * as desired. Each limit is applied to a new provision, and if any of the
 * limits, the provision is rejected.
 *
 * As an example, to allow an account to have up to 25 VMs, a maximum of
 * 25600MiB RAM and 2.5TiB disk across the datacenter, and specifically only
 * allow them to use 2048MiB RAM for the heretical penguin-loving Linux,
 * add the following four limits to the account:
 * { "value": 25 }
 * { "value": 25600, "by": "ram" }
 * { "value": 2560, "by": "quota" }
 * { "value": 2048, "by": "ram", "check": "os", "os": "other" }
 *
 * There are two places that limits can be stored, and this is also reflected in
 * their use case:
 *
 * 1. sapi, both for sdc-docker and cloudapi. This is where default limits and
 *    categories of limits for large numbers of users are kept. These limits
 *    typically rarely change.
 * 2. ufds, which is for individual accounts. These are used to add exceptions
 *    to the defaults and categories stored in sapi.
 *
 * A typical use-case is to prevent all accounts from using more than a limited
 * amount of RAM of VMs across a datacenter, until their account has been vetted
 * by support (e.g. credit card number isn't fraudulent). After vetting, the
 * limit is bumped substantially. In this use-case, small limits would be set in
 * sdc-docker's and cloudapi's sapi configuration to serve as defaults. Once
 * support has vetted the account, they can add a limit in ufds for that account
 * to override the defaults, thus bumping the amount of RAM or VMs the account
 * can provision.
 *
 * Limits are added to sdc-docker through sapi by adding a configuration for
 * this sdc-docker plugin:
 *
 * DOCKER_UUID=$(sdc-sapi /services?name=docker | json -Ha uuid)
 * sdc-sapi /services/$DOCKER_UUID -X PUT -d '{
 *     "metadata": {
 *         "DOCKER_PLUGINS": "[{\"name\":\"provision_limits\", \
 *         \"enabled\": true,\"config\":{\"defaults\":[{\"value\":2 }]}}]"
 *     }
 * }'
 *
 * Likewise for cloudapi:
 *
 * CLOUDAPI_UUID=$(sdc-sapi /services?name=cloudapi | json -Ha uuid)
 * sdc-sapi /services/$CLOUDAPI_UUID -X PUT -d '{
 *     "metadata": {
 *         "CLOUDAPI_PLUGINS": "[{\"name\":\"provision_limits\", \
 *         \"enabled\": true,\"config\":{\"defaults\":[{\"value\":2 }]}}]"
 *     }
 * }'
 *
 * The above examples completely replace DOCKER_PLUGINS and CLOUDAPI_PLUGINS,
 * so make sure to check that you're not overwriting the configurations for
 * other plugins in the process.
 *
 * Looking at this plugin's configuration:
 * { "defaults": [<limits>] }
 *
 * Limits in "defaults" are applied to all provisions unless specifically
 * overridden with a ufds limit. Additional categories can be added in the
 * plugin's configuration, and their names are up to you. E.g.:
 * {
 *     "defaults": [
 *         { "value": 2 },
 *         { "value": 1024, "by": "ram" }
 *     ]
 *     "small": [
 *         { "value": 20 },
 *         { "value": 10, "check": "brand", "brand": "kvm" },
 *         { "value": 327680, "by": "ram" },
 *         { "value": 2000, "by": "quota" }
 *     ]
 *     "whale": [
 *         { "value": 10000 },
 *         { "value": 327680000, "by": "ram" },
 *         { "value": 1000000, "by" :"quota" }
 *     ]
 * }
 *
 * The above configuration has defaults which are applied to all accounts that
 * do not have a category set in "tenant" (see below). There are two added
 * category of users: "small" and "whale". The "small" category allows accounts
 * to have up to 20 VMs, up to 10 KVM instances, and a total of 320GiB RAM and
 * 2000GiB disk across the datacenter. The "whale" category is much, much
 * higher.
 *
 * Which category an account falls in is determined by the "tenant" attribute on
 * that account in ufds. If the attribute is blank or absent (or a category
 * that doesn't exist in the configuration), the account uses "defaults" limits.
 * If the attribute is present and matches a category in the plugin
 * those are the limits used. For example, this account is a whale:
 *
 * $ sdc-ufds search '(login=megacorp)' | json tenant
 * whale
 *
 * To override any of these defaults or categories in ufds, add a capilimit
 * entry. It takes the general form of:
 *
 * sdc-ufds add '
 * {
 *   "dn": "dclimit=$DATACENTER, uuid=$ACCOUNT_UUID, ou=users, o=smartdc",
 *   "datacenter": "$DATACENTER",
 *   "objectclass": "capilimit",
 *   "limit": ["<JSON limit>", "<JSON limit>", ...]
 * }'
 *
 * Or you could use adminui, which lets operators do the same with a friendly
 * discoverable GUI.
 */

var assert = require('assert-plus');
var jsprim = require('jsprim');
var vasync = require('vasync');


// --- Globals

var QUOTA_ERR = 'Quota exceeded; to have your limits raised please contact '
    + 'Support';
var BRAND = 'brand';
var IMAGE = 'image';
var OS = 'os';
var RAM = 'ram';
var QUOTA = 'quota';
var ANY = 'any';


/*
 * DC limits come in two formats, as a result of how ufds (LDAP) works:
 * a single JSON string, or an array of JSON strings. Each string represents
 * a single limit. We deserialize these strings here.
 *
 * Returns an array of limit objects.
 */
function convertFromCapi(log, dcUserLimits) {
    assert.object(log, 'log');
    assert.optionalObject(dcUserLimits, 'dcUserLimits');

    if (!dcUserLimits) {
        return [];
    }

    var rawLimits = dcUserLimits.limit;
    if (!rawLimits) {
        return [];
    }

    if (typeof (rawLimits) === 'string') {
        rawLimits = [rawLimits];
    }

    var parsedLimits = [];
    rawLimits.forEach(function (raw) {
        try {
            parsedLimits.push(JSON.parse(raw));
        } catch (_e) {
            log.warn({
                failed_json_string: raw
            }, 'Failed to deserialize DC provision limit!');
        }
    });

    return parsedLimits;
}


/*
 * Take an array of limit objects and convert their value attributes to numbers.
 *
 * Returns limits with all values as numbers.
 */
function atoiValues(limits) {
    assert.arrayOfObject(limits, 'limits');

    limits.forEach(function (limit) {
        if (limit.value !== undefined) {
            limit.value = parseInt(limit.value, 10) || 0;
        }
    });

    return limits;
}


/*
 * Given limits specified in sdc-docker's and cloudapi's config file, and limits
 * placed on an account in this DC, merge the two sets of limits into one. DC
 * limits take priority over config limits, and if any of the DC limits has a
 * image/os value of 'any' we skip config limits altogether.
 *
 * We also do some cleaning/a few rudimentary optimizations here.
 *
 * Returns an array of limit objects.
 */
function filterLimits(log, service, cfgUserLimits, rawDcUserLimits) {
    assert.object(log, 'log');
    assert.string(service, 'service');
    assert.arrayOfObject(cfgUserLimits, 'cfgUserLimits');
    assert.optionalObject(rawDcUserLimits, 'dcUserLimits');

    var dcUserLimits = convertFromCapi(log, rawDcUserLimits);

    // Convert any value attributes to numbers
    dcUserLimits = atoiValues(dcUserLimits);
    cfgUserLimits = atoiValues(jsprim.deepCopy(cfgUserLimits));

    // If the user has any DC-wide wildcard limits specified, we skip any limits
    // specified in the sapi config.
    var hasDcWildcards = dcUserLimits.some(function (limit) {
        return !limit.check || limit.brand === ANY || limit.image === ANY ||
            limit.os === ANY;
    });

    // Union of the set of DC and config limits
    var unionUserLimits = dcUserLimits.slice();

    if (!hasDcWildcards) {
        // Add any config limit which hasn't been overridden by a DC limit
        cfgUserLimits.forEach(function (cfgLimit) {
            var collision = dcUserLimits.some(function (dcLimit) {
                return dcLimit.check && dcLimit.check === cfgLimit.check &&
                    dcLimit.by && dcLimit.by === cfgLimit.by;
            });

            if (!collision) {
                unionUserLimits.push(cfgLimit);
            }
        });
    }

    // {image: 'any'} and {os: 'any'} are equivalent to {}: they're limits that
    // apply to everything.
    unionUserLimits.forEach(function simplifyAny(limit) {
        if (limit.brand === ANY || limit.image === ANY || limit.os === ANY) {
            limit.check = undefined;
            limit.image = undefined;
            limit.brand = undefined;
            limit.os = undefined;
        }
    });

    // Remove and log invalid limits
    unionUserLimits = unionUserLimits.filter(function validateLimit(limit) {
        if ((limit.check === BRAND && !limit.brand) ||
            (limit.check === IMAGE && !limit.image) ||
            (limit.check === OS && !limit.os)) {
            log.warn({ limit: limit }, 'Invalid limit; entry is incomplete');
            return false;
        }

        return true;
    });

    // cloudapi currently supports filtering by image OS and name, but other
    // services (i.e. Docker) don't need to. In the future image OS and name
    // very likely be removed, albeit is not officially deprecated yet.
    if (service !== 'cloudapi') {
        unionUserLimits = unionUserLimits.filter(function stripImgAttr(limit) {
            return limit.check !== IMAGE && limit.check !== OS;
        });
    }

    // Any limit with a value of 0 means 'unlimited', so we remove such limits
    // here since they're effectively a nop when filtering on them.
    return unionUserLimits.filter(function filterZero(limit) {
        return limit.value !== 0;
    });
}


/*
 * Determine what the VM's brand will be from an image.
 *
 * Returns a brand as string, or undefined if unrecognized image.
 */
function getBrand(image) {
    assert.object(image, 'image');

    var brand = image.requirements && image.requirements.brand;

    if (!brand) {
        var imgType = image.type;

        if (imgType === 'lx-dataset' || imgType === 'docker') {
            brand = 'lx';
        } else if (imgType === 'zone-dataset') {
            brand = 'joyent';
        } else if (imgType === 'zvol') {
            brand = 'kvm';
        }
    }

    return brand;
}


function sum(a, b) {
    return a + b;
}


/*
 * Takes a look at all of a user's VMs, and determines whether this provision
 * will shoot over any limits set. The three possible limits are for the sum of
 * all RAM across the DC (in MiB), the sum of all disk across the DC (in GiB),
 * and the total number of an account's VMs. Each of these limits can be
 * optionally be restricted to VMs made using an image with the given name, or
 * VMs that contain a certain OS.
 *
 * Some examples:
 *
 * - account limited to total 2GiB RAM across whole DC:
 *   { "by": "ram", "value": 2048 }
 *
 * - account limited to total 1TiB disk across whole DC for VMs with "other"
 *   OS; "other" is usually used for Docker:
 *   { "check": "os", "os": "other", "by": "quota", "value": 1024 }
 *
 * - account limited to 1GiB RAM across DC, 25GiB disk across DC, and can have
 *   no more than four VMs:
 *   { "by": "ram", "value": 1024 }
 *   { "by": "quota", "value": 25 }
 *   { "value": 4 }
 *
 * Unknown checks (i.e. not "ram" or "quota") are treated as the default case:
 * counting VMs. Not great, but this is to keep consistent with the cloudapi
 * plugin's behaviour.
 */
function setLimitsUsed(log, vms, limits) {
    assert.object(log, 'log');
    assert.arrayOfObject(vms, 'vms');
    assert.arrayOfObject(limits, 'limits');

    // Loop through each limit and set how much is used.
    for (var i = 0; i < limits.length; i++) {
        var limit = limits[i];

        var machines = vms;
        /* eslint-disable no-loop-func */
        if (limit.check === BRAND) {
            // All VMs with a particular brand.
            machines = vms.filter(function brandFilter(vm) {
                return vm.brand === limit.brand;
            });
        } else if (limit.check === IMAGE) {
            // All VMs matching image name.
            machines = vms.filter(function imgFilter(vm) {
                return vm.image_name === limit.image;
            });
        } else if (limit.check === OS) {
            // All VMs matching the OS name.
            machines = vms.filter(function osFilter(vm) {
                return vm.os === limit.os;
            });
        }
        /* eslint-enable no-loop-func */

        // Default to the number of machines.
        var count = machines.length;

        if (limit.by === RAM) {
            // RAM; in MiB
            count = machines.map(function (vm) {
                return vm.ram;
            }).reduce(sum, 0);
        } else if (limit.by === QUOTA) {
            // Disk; VMs and limits are in GiB, but packages in MiB
            count = machines.map(function (vm) {
                return vm.quota;
            }).reduce(sum, 0);
        }

        limit.used = count;
    }
}


/*
 * Returns a boolean: true means provision is a go, false means provision should
 * be rejected.
 */
function canProvision(log, resizeVm, pkg, vms, limits) {
    assert.object(log, 'log');
    assert.object(pkg, 'pkg');
    assert.optionalObject(resizeVm, 'resizeVm');
    assert.arrayOfObject(vms, 'vms');
    assert.arrayOfObject(limits, 'limits');

    setLimitsUsed(log, vms, limits);

    log.debug('Used limits', limits);

    // Loop through each limit and ensure that it passes. If any limit fails,
    // this provision fails.
    return limits.every(function _checkLimitExceeded(limit) {
        // Add the new pkg values (subtracting the old vm value when resizing).
        if (limit.by === RAM) {
            limit.used += pkg.max_physical_memory;
            if (resizeVm) {
                limit.used -= resizeVm.ram;
            }
        } else if (limit.by === QUOTA) {
            limit.used += (pkg.quota / 1024);
            if (resizeVm) {
                limit.used -= resizeVm.quota;
            }
        } else if (resizeVm) {
            // If we are resizing, we don't care about the number of machines.
            // We bail here since we don't want to prevent resizing if we
            // somehow are over a limit on number of machines.
            log.info({ limit: limit }, 'Resizing; skipping vm count');
            return true;
        } else {
            // Not resizing, which means we are provisioning a new instance,
            // so add one extra vm to the count.
            limit.used += 1;
        }

        if (limit.used <= limit.value) {
            return true;
        }
        log.info({ limit: limit }, 'Provision/resize limit exceeded');
        return false;
    });
}


/*
 * Look at what the set of limits will be filtering on, and determine what
 * are the minimal number of fields we need vmapi to populate each VM object
 * with; this reduces serialization/deserialization time on both ends.
 *
 * One major limitation in vmapi is that it doesn't recognize "image_uuid" as
 * a field, so if we need any information that can only be found in imgapi, we
 * have no choice but to load complete vmapi objects.
 *
 * Returns a query string to use with vmapi's ListVms ?field=. Returns undefined
 * if we'll use the default object layout instead.
 */
function findMinimalFields(limits) {
    assert.arrayOfObject(limits, 'limits');

    var needImageUuid = limits.some(function (limit) {
        return limit.check === IMAGE || limit.check === OS;
    });

    if (needImageUuid) {
        // Cannot use fields because vmapi doesn't understand
        // ?fields=image_uuid, so we have to load everything :(
        return undefined;
    }

    var needRam = limits.some(function (limit) {
        return limit.by === RAM;
    });

    var needQuota = limits.some(function (limit) {
        return limit.by === QUOTA;
    });

    if (needRam && needQuota) {
        return 'ram,quota';
    } else if (needQuota) {
        return 'quota';
    } else if (needRam) {
        return 'ram';
    } else {
        // vmapi won't return empty objects, so we need at least one attribute
        // regardless of whether it's needed or not
        return 'ram';
    }
}


/*
 * Fetch all the VMs from vmapi that we'll need to apply the given limits. If
 * any of the limits require that VM objects are populated with details of their
 * image's OS or name, we need to ensure we have an imgapi version of the image
 * manifest.
 *
 * Note that when "image" is undefined, we are looking up all limit usage, else
 * when image exists then we are checking the limits for a provisioning/resizing
 * instance.
 *
 * If we'll be filtering by image name or OS, we can throw away all image or OS
 * limits that don't apply to this provision once we know the provision's image
 * OS or name. After all, at that point the only limits that apply either match
 * the provision's name and OS, or aren't matching on name or OS.
 *
 * Calls cb(err, vms, vmImage, limits), where vms is the list of VMs
 * (populated with "image_name" and "os" if required by the limits), vmImage
 * (also populated with "name" and "os" if required by the limits), and limits
 * (a new set of limits once we've throw away now-irrelevant limits).
 */
function getVms(log, api, account, image, limits, reqId, cb) {
    assert.object(log, 'log');
    assert.object(api, 'api');
    assert.object(account, 'account');
    assert.optionalObject(image, 'image');
    assert.arrayOfObject(limits, 'limits');
    assert.uuid(reqId, 'reqId');
    assert.func(cb, 'cb');

    var imageLookup = {};
    var vms = [];
    var brand;

    // Depending on the service using this plugin, we may get a Moray image
    // manifest (i.e. from sdc-docker), or we may get an imgapi image manifest
    // (i.e. from sdc-cloudapi). The image object that sdc-docker stores in
    // Moray doesn't have the information we need if any of the limits will be
    // checking by either image name or OS, thus we load it here.
    function getVmImage(_, next) {
        log.trace('Running getVmImage');

        if (!image) {
            // No need to get/convert the image.
            return next();
        }

        var needVmImage = limits.some(function (limit) {
            var check = limit.check;
            return check === BRAND || check === IMAGE || check === OS;
        });

        var isMorayImage = (image.constructor &&
            image.constructor.name === 'ImageV2');

        if (!needVmImage || !isMorayImage) {
            log.debug('Loading imgapi image unneeded for filtering; skipping');
            return next();
        }

        var vmImgUuid = image.image_uuid;
        log.debug('Loading imgapi image for limit filtering:', vmImgUuid);

        return api.getImage({
            image: { uuid: vmImgUuid },
            req_id: reqId
        }, function getImageCb(err, _image) {
            if (err) {
                return next(err);
            }

            image = _image;

            log.debug({ vm_image: image }, 'Loaded VM\'s image');

            return next();
        });
    }

    // Drop any limits that reference an image/os/brand that we dont' care
    // about (i.e. when provisioning/resizing we only care about limits that
    // reference the same image/os/brand as the provisioned/resized instance).
    function refineLimits(_, next) {
        if (!image) {
            // When not filtering on an image, we cannot refine the filters.
            return next();
        }

        var needBrand = limits.some(function (limit) {
            return limit.check === BRAND;
        });

        if (needBrand) {
            // If any limits filter by brand, we'll have loaded an imgapi image
            // in getVmImage().
            brand = getBrand(image);
            if (!brand) {
                var errMsg = 'Unable to determine brand of image ' + image.uuid;
                return next(new Error(errMsg));
            }
        }

        // limits after filtering can contain at most one image name and one os
        // name to query, so we will have at most two imgapi queries later.
        // Brand doesn't cause an imgapi query since that information is already
        // on vmapi objects.
        limits = limits.filter(function filterRelevant(limit) {
            if (limit.check === BRAND) {
                return limit.brand === brand;
            }

            if (limit.check === IMAGE) {
                return limit.image === image.name;
            }

            if (limit.check === OS) {
                return limit.os === image.os;
            }

            return true;
        });

        log.debug({ limits: limits }, 'Found applicable limits');

        return next();
    }

    // Helper function used by getOsImages() and getNameImages()
    function getImages(opts, next) {
        assert.object(opts, 'opts');
        assert.func(next, 'next');

        opts.state = 'all';
        opts.req_id = reqId;

        api.listImages(opts, function listImagesCb(err, images) {
            if (err) {
                return next(err);
            }

            log.debug({opts: opts, numImages: images.length}, 'Loaded images');

            images.forEach(function (img) {
                imageLookup[img.uuid] = img;
            });

            return next();
        });
    }

    // Search for images that match the VM image's OS, but only if needed
    function getOsImages(_, next) {
        log.trace('Running getOsImages');

        var osNames = limits.filter(function (limit) {
            return limit.check === OS;
        }).map(function (limit) {
            return limit.os;
        });

        if (osNames.length === 0) {
            log.debug('The OS is not needed for limit filtering; skipping');
            return next();
        }

        if (image) {
            // For provisioning/resizing, we can optimize this so that
            // we only return images that share the same image os as the
            // provisioning (or resizing) instance.
            log.debug('load images with os name: ', image.os);
            return getImages({ os: image.os }, next);
        }

        // Else when loading limits used, we need all images that the filters
        // specify.
        var uniqueNames = new Set(osNames);
        log.debug('load images with os names: ', osNames);

        function loadOsImages(osName, nextOs) {
            getImages({ os: osName }, nextOs);
        }
        vasync.forEachPipeline(
            {
                inputs: Array.from(uniqueNames),
                func: loadOsImages
            },
            next);
        return undefined;
    }

    // Search for images that match the VM image's name, but only if needed
    function getNameImages(_, next) {
        log.trace('Running getNameImages');

        var imageNames = limits.filter(function (limit) {
            return limit.check === IMAGE;
        }).map(function _mapImageNames(limit) {
            return limit.image;
        });

        if (imageNames.length === 0) {
            log.debug('Image names not needed for limit filtering; skipping');
            return next();
        }

        if (image) {
            // For provisioning/resizing, we can optimize this so that
            // we only return images that share the same image name as the
            // provisioning (or resizing) instance.
            log.debug('load images with image name: ', image.name);
            return getImages({ name: image.name }, next);
        }

        // Else when loading limits used, we need all images that the filters
        // specify.
        var uniqueNames = new Set(imageNames);
        function loadNamedImages(imageName, nextName) {
            getImages({ name: imageName }, nextName);
        }
        vasync.forEachPipeline(
            {
                inputs: Array.from(uniqueNames),
                func: loadNamedImages
            },
            next);
        return undefined;
    }

    // Unfortunately, vmapi VMs don't have an 'os' attribute, nor do they store
    // image names. Therefore we're stuck always loading all of an account's
    // active VMs. This is really Not Great.
    //
    // There are various convoluted optimizations we could try and pull (e.g.
    // we can make individual vmapi queries for each ?image_uuid=, iff all
    // applicable limits involve the image name), but if the current approach
    // becomes too expensive it'd be simplest to have vmapi store the 'os' and
    // 'image_name' attributes. '?fields=' needs to be extended to support
    // image_uuid as well. And if vmapi grew a fast path for HEAD with an object
    // count, that would be pretty handy...
    //
    // Calls cb(err, vms, image, limits), where vms is an array of VMs loaded
    // from vmapi, image comes from imgapi (if needed later on, otherwise it
    // might be a Moray image manifest) and matches the current provision, and
    // limits are a new set of limits filtered to match the current provision
    // given new information about the provision's OS and image name (if
    // relevant).
    function getAccountVms(_, next) {
        log.trace('Running getAccountVms');

        var brandLimits = limits.filter(function isBrandLimit(limit) {
            return limit.check === BRAND;
        });

        var opts = {
            account: account,
            fields: findMinimalFields(limits),
            req_id: reqId
        };

        if (brandLimits.length > 0 && brandLimits.length === limits.length) {
            // all limits are brand limits, so we only need to fetch VMs with
            // our image's brand
            opts.brand = brand;
        }

        api.getActiveVmsForAccount(opts, function getAccountVmsCb(err, _vms) {
            if (err) {
                return (err);
            }

            vms = _vms;

            // Add 'os' and 'image_name' fields to vms when available. VMs which
            // don't have a matching image are not under consideration for any
            // "check":"image"/"os" (if applicable) in any case, which was why
            // we didn't load those images earlier.
            vms.forEach(function addVmAttr(vm) {
                var img = imageLookup[vm.image_uuid];
                if (img) {
                    vm.image_name = img.name;
                    vm.os = img.os;
                }
            });

            log.debug({
                vm_count: vms.length
            }, 'VMs loaded');

            return next();
        });
    }

    vasync.pipeline({
        funcs: [
            getVmImage,
            refineLimits,
            getOsImages,
            getNameImages,
            getAccountVms
        ]
    }, function vasyncCb(err) {
        cb(err, vms, image, limits);
    });
}


/*
 * Return the merged set of limits, reading from the UFDS account and
 * the configuration.
 */
function getMergedAccountLimits(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.account, 'opts.account');
    assert.object(opts.api, 'opts.api');
    assert.object(opts.config, 'opts.config');
    assert.func(cb, 'cb');

    var account = opts.account;
    var api = opts.api;
    var config = opts.config;
    var log = api.log;

    if (account.isAdmin()) {
        log.debug({account_uuid: account.uuid},
            'Account is admin; no limits');
        cb(null, []);
        return;
    }

    // Fetch all of this account's DC limits from ufds.
    account.listLimits(function listLimitsCb(err, globalUserLimits) {
        if (err) {
            cb(err);
            return;
        }

        // Since ufds replicates between DCs, we're only interested in any
        // limits that apply to this DC specifically.
        var dcUserLimits = (globalUserLimits || []).find(function (limit) {
            return limit.datacenter === api.datacenterName;
        });

        // We use a specific class of sapi-specified limits if the account
        // has that class, otherwise fall back to defaults.
        var cfgUserLimits = config[account.tenant] || config.defaults || [];

        // Merge and optimize a bit the two sets of limits.
        var limits = filterLimits(log, api.service, cfgUserLimits,
            dcUserLimits);

        if (!limits.length) {
            log.debug({account_uuid: account.uuid}, 'No limits found');
            cb(null, []);
            return;
        }

        log.debug({account_uuid: account.uuid, limits: JSON.stringify(limits)},
            'Loaded account limits');

        cb(null, limits);
    });
}


/*
 * Given a new provision or resize, load all limits that apply to the current
 * account both in sdc-docker's config and in ufds, determine which limits are
 * relevant to this provision/resize, and check that the provision/resize won't
 * violate any of those limits.
 *
 * Calls cb(err), where no error means that the provision/resize can proceed.
 * An error should halt the provision or resize.
 */
function allowProvisionOrResize(api, cfg) {
    assert.object(api, 'api');
    assert.object(api.log, 'api.log');
    assert.string(api.service, 'api.service');
    assert.object(cfg, 'cfg');
    assert.arrayOfObject(cfg.defaults, 'cfg.defaults');

    var log = api.log;

    return function checkProvisionAndResizeLimits(opts, cb) {
        assert.object(opts, 'opts');
        assert.object(opts.account, 'opts.account');
        assert.optionalObject(opts.vm, 'opts.vm');
        assert.object(opts.image, 'opts.image');
        assert.object(opts.pkg, 'opts.pkg');
        assert.uuid(opts.req_id, 'opts.req_id');
        assert.func(cb, 'cb');

        var account = opts.account;
        var resizeVm = opts.vm; // the VM being resized if resizing
        var image = opts.image;
        var pkg = opts.pkg;
        var reqId = opts.req_id;

        log.debug('Running', checkProvisionAndResizeLimits.name);

        getMergedAccountLimits({
            account: account,
            api: api,
            config: cfg
        }, function _onGetAccountLimitsCb(err, limits) {
            if (err) {
                return cb(err);
            }

            if (!limits.length) {
                log.debug('No limits to be applied; skipping ' +
                    'provision/resize limits');
                return cb();
            }

            log.debug({ limits: limits }, 'Will apply provison/resize limits');

            var disallow = limits.some(function (limit) {
                return limit.value <= -1;
            });

            if (disallow) {
                log.info('Disallowing provision/resize because -1 limit ' +
                    'value found');
                return cb(new api.NotAuthorizedError(QUOTA_ERR));
            }

            // Load and populate any required VMs from imgapi to check against
            // the given limits. Narrow the limits based on new information
            // available from those queries.
            return getVms(log, api, account, image, limits, reqId,
                function onGetVms(err2, vms, image2, fittedLimits) {
                if (err2) {
                    return cb(err2);
                }

                log.info({
                    vm_count: vms.length,
                    limits: fittedLimits,
                    img_os: image2.os,
                    img_name: image2.name
                }, 'VMs loaded and provision/resize limits adjusted');

                var allow = canProvision(log, resizeVm, pkg, vms,
                    fittedLimits);

                if (!allow) {
                    return cb(new api.NotAuthorizedError(QUOTA_ERR));
                }

                return cb();
            });
        });
    };
}


/*
 * Load all limits that apply to the current account both in the service config
 * and in ufds, load how much is used for each of those limits that apply to
 * the current dc.
 *
 * Callback is `cb(err, limits)`.
 */
function getProvisionLimits(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.account, 'opts.account');
    assert.object(opts.api, 'opts.api');
    assert.object(opts.config, 'opts.config');
    assert.uuid(opts.req_id, 'opts.req_id');
    assert.func(cb, 'cb');

    var account = opts.account;
    var api = opts.api;
    var config = opts.config;
    var log = api.log;
    var reqId = opts.req_id;

    getMergedAccountLimits({
        account: account,
        api: api,
        config: config
    }, function _getAccountLimitsCb(err, limits) {
        if (err) {
            cb(err);
            return;
        }

        if (!limits.length) {
            cb(null, []);
            return;
        }

        getVms(log, api, account, null, limits, reqId,
            function onGetVms(err2, vms) {
            if (err2) {
                cb(err2);
                return;
            }

            log.info({
                vm_count: vms.length
            }, 'VMs loaded');

            setLimitsUsed(log, vms, limits);

            cb(null, limits);
        });
    });
}


module.exports = {
    // hooks loaded by PluginManager
    allowProvision: allowProvisionOrResize,
    allowResize: allowProvisionOrResize,
    // hook for account limits
    _getProvisionLimits: getProvisionLimits,

    // and these are additionally exported for tests
    _convertFromCapi: convertFromCapi,
    _atoiValues: atoiValues,
    _filterLimits: filterLimits,
    _getBrand: getBrand,
    _canProvision: canProvision,
    _findMinimalFields: findMinimalFields,
    _getVms: getVms
};
