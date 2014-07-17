/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Provide a simple cache interface using Redis, where entries have a limited
 * lifetime.
 */


/*
 * Attempt to fetch cached data listing for a given key from Redis.
 *
 * We don't ever return err to cb, since we want a redis failure to be treated
 * the same as a cache miss. If redis disappears, we must still progress.
 */
function getCache(req, key, canUseCache, cb) {
    if (!canUseCache) {
        return cb();
    }

    var redis = req.sdc.redis;

    return redis.get(key, function (err, json) {
        if (err) {
            req.log.warn({ err: err }, 'Failed redis cache get');
            return cb();
        }

        if (!json) {
            req.log.trace('Redis cache miss on key ' + key);
            return cb();
        }

        req.log.trace('Redis cache hit on key ' + key);

        try {
            var obj = JSON.parse(json);
        } catch (e) {
            req.log.warn({ err: e }, 'Error deserializing redis cache hit');
            return cb();
        }

        return cb(null, obj);
    });
}


/*
 * Try to serialize and store an object for a given key in Redis. The object is
 * transformed into JSON, stored in Redis, and given a lifetime so that it
 * expires out after a while.
 *
 * While async, we never call back from this function. Errors are logged, but
 * otherwise swallowed.
 */
function setCache(req, key, lifetime, obj) {
    var redis    = req.sdc.redis;
    var json     = JSON.stringify(obj);

    req.log.trace('Saving object to redis under key ' + key);

    redis.multi().set(key, json).expire(key, lifetime).exec(function (err) {
        if (err) {
            req.log.warn({ err: err }, 'Unable to save to redis cache');
        }
    });
}


/*
 * Invalidate any given key in Redis.
 *
 * While async, we never call back from this function. Errors are logged, but
 * otherwise swallowed.
 */
function invalidateCache(req, key) {
    var redis = req.sdc.redis;

    req.log.trace('Invalidating any object in redis under key ' + key);

    redis.del(function (err) {
        if (err) {
            req.log.warn({ err: err }, 'Unable to invalidate redis entry');
        }
    });
}


module.exports = {
    get: getCache,
    set: setCache,
    invalidate: invalidateCache
};