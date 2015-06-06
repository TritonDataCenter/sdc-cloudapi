"use strict"

// Workaround exists without using the forked version of restify-oauth2, see below
var restifyOAuth2 = require('restify-oauth2');
// Helper class to help us to get around some issues
var _ = require('underscore');
// Crypto to generate token
var crypto = require("crypto");
// For now, we will have hard coded endpoint
var tokenEndpoint = '/token';
// Default TTL for tokens
var TTL = 86400;

/*
	For prototype purposes, client details are hard coded
*/
var database = {
	clients: {
		officialApiClient: {
			secret: "C0FFEE"
		},
		unofficialClient: {
			secret: "DECAF"
		}
	}
};

function generateToken(data) {
	var random = Math.floor(Math.random() * 100001);
	var timestamp = (new Date()).getTime();
	var sha256 = crypto.createHmac("sha256", random + "WOO" + timestamp);

	return sha256.update(data).digest("base64");
}

//module.exports.validateClient = function(credentials, req, cb) {
function validateClient(credentials, req, cb) {
	// Call back with `true` to signal that the client is valid, and `false` otherwise.
	// Call back with an error if you encounter an internal server error situation while trying to validate.

	var isValid = _.has(database.clients, credentials.clientId) &&
		database.clients[credentials.clientId].secret === credentials.clientSecret;
	cb(null, isValid);
}

//module.exports.grantUserToken = function(credentials, req, cb) {
function grantUserToken(credentials, req, cb) {
	var ufds = req.sdc.ufds;
	var cache = req.sdc.cache;
	ufds.authenticate(credentials.username, credentials.password, function(err, customer) {
		if (err) {
			cb(null, false);
		} else {
			var token = generateToken(credentials.username + ":" + credentials.password);
			cache.storeToken(token, TTL, credentials.username, function() {
				return cb(null, token);
			})
		}
	});
}

//module.exports.authenticateToken = function(credentials, req, cb) {
function authenticateToken(token, req, cb) {
	var cache = req.sdc.cache;
	cache.tokenExists(token, function(err, r) {
		if (r === 1) {
			return cache.getUsername(token, function(err, u) {
				req.username = u;
				cb(null, true);
			})
		}else{
			cb(null, false);
		}
	});
	
};

function setTokenEndpoint(ep) {
	tokenEndpoint = ep;
}

function setTTL(sec) {
	TTL = sec;
}

function getOptions() {
	return {
		tokenEndpoint: tokenEndpoint,
		tokenExpirationTime: TTL,
		hooks: {
			validateClient: validateClient,
			grantUserToken: grantUserToken,
			authenticateToken: authenticateToken
		}
	}
}

function beforeOAuth(req, res, next) {

	/*
		Because we want to have req.params and req.body at the same time without
		modifying anything else in CloudAPI (bodyparser for example) and
		restify-oauth2, we are going to hack it.
	*/
	if (req.url === tokenEndpoint) {
		req.body = req.params;
	}

	/*
		By default restify-oauth2 takes care of authorization headers regardless
		OAuth or not, and it interferes with CloudAPI, therefore we need to 
		null the Scheme if it is not Bearer
	*/

	req.isOAuth = true;
	/*
		a. /token is handled by OAuth, so we pass
		b. Getting access token is "Basic", not "Bearer"
	*/
	if (req.url !== tokenEndpoint && req.authorization && req.authorization.scheme && req.authorization.scheme.toLowerCase() !== 'bearer') {
		req.isOAuth = false;
		req._authorization = _.clone(req.authorization);
		req.authorization = {
			'scheme': null
		};
	}
	return next();
}

function afterOAuth(req, res, next) {
	/*
		Now that we get passed OAuth, let's restore what we had
	*/
	if (req.isOAuth === false) {
		req.username = 'anonymous'; // as per lib/auth.js, as lib/common/makeSetup.js at restify-oauth2 changes it to null
		req.authorization = _.clone(req._authorization);
		req._authorization = null;
		delete req._authorization;
	}
	return next();
}

function mount(server, ep) {

	// Endpoint
	setTokenEndpoint(ep);

	//Server
	server.use(beforeOAuth);
	restifyOAuth2.ropc(server, getOptions());
	server.use(afterOAuth);

	return server;
}

module.exports = {
	mount: mount,
	beforeOAuth: beforeOAuth,
	afterOAuth: afterOAuth,
	getOptions: getOptions,
	setTokenEndpoint: setTokenEndpoint
};