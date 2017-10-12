var assert = require('assert-plus');

var mod_networks = require('../networks');

function loadNetworks(req, res, next) {
    var method = req.method.toUpperCase();
    var pathname = req.getUrl().pathname;

    var napi = req.sdc.napi;
    assert.ok(napi);

    if (pathname === '/--ping') {
        return next();
    }

    assert.ok(req.account);
    var accountUuid = req.account.uuid;
    assert.ok(accountUuid);

    var netFilterOpts = {
        provisionable_by: accountUuid
    };

    if (req.query && req.query.fabric) {
        netFilterOpts = {
            fabric: true,
            owner_uuid: accountUuid
        };
    }


    // Skip network loading and filtering unless when a request is sent to:
    //
    // 1. networks end-points
    // 2. create a machine
    // 3. create a nic
    // 4. update the user's config
    // 5. create a volume
    //
    // As all of the items above require up-to-date networking information being
    // loaded.
    if (!/\/networks/.test(pathname) &&
        !(/\/machines$/.test(pathname) && method === 'POST') &&
        !(/\/nics$/.test(pathname) && method === 'POST') &&
        !(/\/config/.test(pathname) && method === 'PUT') &&
        !(/\/volumes$/.test(pathname) && method === 'POST')) {
        return next();
    }

    return napi.listNetworkPools({
        provisionable_by: accountUuid
    }, {
        'x-request-id': req.getId()
    }, function (err, pools) {
        if (err) {
            return next(err);
        }

        var networks = [];
        var externalNetworks = [];
        var internalNetworks = [];
        var networksInPools = {};

        // Always skip admin network pools:
        pools = pools.filter(function (pool) {
            return (pool.nic_tag !== req.config.admin_nic_tag);
        });

        pools.forEach(function (pool) {
            var isFabric = false;
            networks.push(pool);

            pool.networks.forEach(function (net) {
                networksInPools[net.uuid] = true;
                if (net.fabric === true) {
                    isFabric = true;
                }
            });

            if (pool.nic_tag === req.config.external_nic_tag) {
                externalNetworks.push(pool.uuid);
            } else if (pool.nic_tag === req.config.internal_nic_tag ||
                isFabric === true) {
                internalNetworks.push(pool.uuid);
            }
        });

        return napi.listNetworks(netFilterOpts, {
            'x-request-id': req.getId()
        }, function (err2, nets) {
            if (err2) {
                return next(err2);
            }

            // Always skip admin networks, and don't add networks which are
            // already in contained pools:
            nets = nets.filter(function (net) {
                return net.nic_tag !== req.config.admin_nic_tag &&
                    !networksInPools[net.uuid];
            });

            networks = networks.concat(nets);

            networks.forEach(function (net) {
                if (net.nic_tag === req.config.external_nic_tag) {
                    externalNetworks.push(net.uuid);
                } else if (net.nic_tag === req.config.internal_nic_tag ||
                    net.fabric === true) {
                    internalNetworks.push(net.uuid);
                }
            });

            // uuids of all publically-accessible networks accessible by user
            req.external_nets = externalNetworks;

            // uuids of all internally-accessible networks accessible by user
            req.internal_nets = internalNetworks;

            // objects of all networks accessible by user
            req.networks = networks;

            req.log.debug({
                external: req.external_nets,
                internal: req.internal_nets
            }, 'networks loaded');

            return next();
        });
    });
}

module.exports = {
    loadNetworks: loadNetworks
};