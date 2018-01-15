---
title: Joyent CloudAPI Administrator's Guide
mediaroot: ./media
apisections:
markdown2extras: tables, code-friendly, cuddled-lists
---
<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2018, Joyent, Inc.
-->

# Overview

CloudAPI is the customer-facing API that supports the Customer Portal, as well
as direct API requests from customers using either the Triton CLIs (e.g.
node-triton) or custom tooling.  CloudAPI is a REST service written in node.js,
and typically runs on the head node.  This document describes configuration and
troubleshooting for the CloudAPI service.

## Customer Documentation

For the end-user documentation, please visit
[CloudAPI documentation](./index.html).

# Layout

CloudAPI is installed in its own zone on the head node, although it is not
installed by default.  The name of the zone is usually `cloudapi0`.  Within the
cloudapi zone, the relevant software is installed under `/opt/smartdc/cloudapi`.
CloudAPI is installed as an SMF service, so log output is placed in:
`/var/svc/log/smartdc-application-cloudapi\:cloudapi-808*.log`

These paths can be easily retrieved with `svcs -L cloudapi`.

The CloudAPI configuration file lives at
`/opt/smartdc/cloudapi/etc/cloudapi.cfg`.


# SAPI Configuration

Some aspects of cloudapi are configured via the "metadata" attribute in the
"cloudapi" service (of the "sdc" application) in SAPI. This is a list of those
knobs.

**Metadata Key**                          | **Type** | **Description**
----------------------------------------- | -------  | ------------------------------------------------
CLOUDAPI_READONLY                         | Boolean  | Default false. Used to put cloudapi into read-only mode for DC maintenance.
CLOUDAPI_DATACENTERS                      | String   | The response for the 'ListDatacenters' endpoint.
CLOUDAPI_SERVICES                         | String   | The response for the 'ListServices' endpoint. See discussion below.
CLOUDAPI_PLUGINS                          | Array    | See "Plugins" section below.
CLOUDAPI_BLEEDING_EDGE_FEATURES           | Array    | See "Bleeding Edge Features" section below.
CLOUDAPI_BLEEDING_EDGE_LOGIN_WHITELIST    | Array    | See "Bleeding Edge Features" section below.
CLOUDAPI_THROTTLE_WHITELIST               | Array    | See "Throttles" section below.
CLOUDAPI_MULTIPLE_PUB_NETWORKS            | Boolean  | Default false. Whether machines can be provisioned with more than one public network.
CLOUDAPI_TEST_MODE                        | Boolean  | Default false. Disable some security checks to make testing easier.
CLOUDAPI_IGNORE_APPROVED_FOR_PROVISIONING | Boolean  | Default false. Allow provisioning for users even if they have not been given permission.

For example, the 'docker' service could be added to CLOUDAPI_SERVICES as
follows.

    docker_endpoint="tcp://docker.coal.joyent.us:2376"
    cloudapi_svc=$(sdc-sapi /services?name=cloudapi | json -H 0.uuid)
    sapiadm get $cloudapi_svc \
        | json -e "
            svcs = JSON.parse(this.metadata.CLOUDAPI_SERVICES || '{}');
            svcs.docker = '$docker_endpoint';
            this.update = {metadata: {CLOUDAPI_SERVICES: JSON.stringify(svcs)}};
            " update \
        | sapiadm update $cloudapi_svc


# Configuration

An example "full" configuration looks like what's below.  The rest of this
section will explain the configuration file.

    {
        "port": 443,
        "certificate": "/opt/smartdc/cloudapi/ssl/cert.pem",
        "key": "/opt/smartdc/cloudapi/ssl/key.pem",
        "read_only": false,
        "datacenters": {
            "coal": "https://10.88.88.131"
        },
        "ufds": {
            "url": "ldaps://10.99.99.14",
            "bindDN": "cn=root",
            "bindPassword": "XXX",
            "cache": {
                "size": 5000,
                "expiry": 60
            }
        },
        "vmapi": {
            "url": "http://10.99.99.22",
            "cache": {
                "size": 5000,
                "expiry": 60
            }
        },
        "cnapi": {
            "url": "http://10.99.99.18",
            "cache": {
                "size": 1000,
                "expiry": 300
            }
        },
        "napi": {
            "url": "http://10.99.99.10",
            "cache": {
                "size": 5000,
                "expiry": 300
            }
        },
        "fwapi": {
            "url": "http://10.99.99.22",
            "cache": {
                "size": 1000,
                "expiry": 300
            }
        },
        "imgapi": {
            "url": "http://10.99.99.17",
            "cache": {
                "size": 5000,
                "expiry": 300
            }
        },
        "ca": {
            "url": "http://10.99.99.24:23181"
        },
        "plugins": [
            {
                "name": "provision_limits",
                "enabled": false,
                "config": {
                    "defaults": [
                        {"check": "os", "os": "smartos", "value": 1},
                        {"check": "brand", "brand": "lx", "by": "ram", "value": 8192}
                    ]
                }
            }, {
                "name": "machine_email",
                "enabled": false,
                "config": {
                    "smtp": {
                        "host": "127.0.0.1",
                        "port": 25,
                        "secureConnection": false,
                        "auth": {
                            "user": "",
                            "pass": ""
                        }
                    },
                    "from": "nobody@joyent.com",
                    "subject": "Your SmartDataCenter machine is provisioning",
                    "body": "Check /my/machines for updates"
                }
            }
        ],
        "userThrottles": {
            "all": {
                "username": true,
                "burst": 30,
                "rate": 10,
                "overrides": {
                    "admin": {
                        "burst": 0,
                        "rate": 0
                    }
                }
            },
            "analytics": false
        },
        "bleeding_edge_features": {
            "": false
        },
        "bleeding_edge_login_whitelist": {
            "": false
        },
        "fabrics_enabled": true,
        "account_allowed_dcs": false,
        "account_allowed_dcs_msg": "",
        "allow_multiple_public_networks": false,
        "test": false
    }


## Top-Level Configuration

    {
        "port": 443,
        "certificate": "/opt/smartdc/cloudapi/ssl/cert.pem",
        "key": "/opt/smartdc/cloudapi/ssl/key.pem",
        "read_only": false,
        "datacenters": {
            "coal": "https://10.88.88.131"
        },
      ...
    }

This portion of the configuration file tells CloudAPI how to start up, and what
datacenter this instance is bound to (along with what other datacenters this
instance should redirect to).

**Field**    | **Type** | **Description**
------------ | -------- | ------------------------------------------------------
port         | Number   | What SSL port to listen on
certificate  | String   | Path to a PEM encoded SSL certificate; can be relative to /opt/smartdc/cloudapi
key          | String   | Path to a PEM encoded private key for the SSL certificate; can be relative to /opt/smartdc/cloudapi
read_only    | Boolean  | When set to true, the API will deny all the POST/PUT/DELETE requests. Provided for review right after upgrading Triton
datacenters  | Object   | A k/v pairing of other DC's to URL's this instance should answer with


## Bleeding Edge Features

    ...
        "bleeding_edge_features": {
            "foo": true,
            "": false
        },
        "bleeding_edge_login_whitelist": {
            "admin": true,
            "": false
        }
    ...

One can define bleeding-edge features by name, and then set a whitelist of user
logins allowed to access those features. Cloudapi code before PUBAPI-816 shows
how to uses this config to guard endpoints and certain functionality. Currently
the "metadata.BLEEDING_EDGE_FEATURES" and
"metadata.BLEEDING_EDGE_LOGIN_WHITELIST" arrays on the "cloudapi" SAPI service
set the features and whitelist.


## UFDS

        "ufds": {
            "url": "ldaps://10.99.99.14",
            "bindDN": "cn=root",
            "bindPassword": "XXX",
            "cache": {
                "size": 5000,
                "expiry": 60
            }
        },

The `ufds` config block tells CloudAPI how to communicate with UFDS, and what
cache settings to use.

**Field**    | **Type** | **Description**
------------ | -------- | ------------------------------------------------------
url          | URL      | The fully-qualified URL where UFDS lives
bindDN       | String   | The DN to bind to UFDS LDAP server with
bindPassword | String   | The password to bind to UFDS LDAP server with
cache        | Object   | Controls the UFDS client cache size and the time to expire it


## VMAPI

        "vmapi": {
            "url": "http://10.99.99.22",
            "cache": {
                "size": 5000,
                "expiry": 60
            }
        },

The `vmapi` config block tells CloudAPI how to communicate with VMAPI, and what
cache settings to use.

**Field** | **Type** | **Description**
--------- | -------- | ---------------------------------------------------------
url       | URL      | The fully-qualified URL where VMAPI lives
cache     | Object   | Controls the VMAPI client cache size and the time to expire it (in seconds)


## WFAPI

        "wfapi": {
            "url": "WFAPI_URL",
            "cache": {
                "size": 1000,
                "expiry": 300
            }
        },

The `wfapi` config block tells CloudAPI how to communicate with Workflow API, and what
cache settings to use.

**Field** | **Type** | **Description**
--------- | -------- | ---------------------------------------------------------
url       | URL      | The fully-qualified URL where WFAPI lives
cache     | Object   | Controls the WFAPI client cache size and the time to expire it (in seconds)


## CNAPI

        "cnapi": {
            "url": "http://10.99.99.18",
            "cache": {
                "size": 5000,
                "expiry": 300
            }
        },


The `cnapi` config block tells CloudAPI how to communicate with CNAPI, and what
cache settings to use.

**Field** | **Type** | **Description**
--------- | -------- | ---------------------------------------------------------
url       | URL      | The fully-qualified URL where CNAPI lives
cache     | Object   | Controls the CNAPI client cache size and the time to expire it (in seconds)


## CA

      "ca": {
        "url": "http://10.99.99.24:23181"
      },

The `ca` config block tells CloudAPI how to communicate with Cloud Analytics,
and what cache settings to use.

**Field** | **Type** | **Description**
--------- | -------- | ---------------------------------------------------------
url       | URL      | The fully-qualified URL where CA lives


## NAPI

        "napi": {
            "url": "http://10.99.99.10",
            "cache": {
                "size": 5000,
                "expiry": 300
            }
        },


The `napi` config block tells CloudAPI how to communicate with NAPI, and what
cache settings to use.

**Field** | **Type** | **Description**
--------- | -------- | ---------------------------------------------------------
url       | URL      | The fully-qualified URL where NAPI lives
cache     | Object   | Controls the NAPI client cache size and the time to expire it (in seconds)


## FWAPI

        "fwapi": {
            "url": "http://10.99.99.22",
            "cache": {
                "size": 5000,
                "expiry": 300
            }
        },


The `fwapi` config block tells CloudAPI how to communicate with FWAPI, and what
cache settings to use.

**Field** | **Type** | Description
--------- | -------- | ---------------------------------------------------------
url       | URL      | The fully-qualified URL where FWAPI lives
cache     | Object   | Controls the FWAPI client cache size and the time to expire it (in seconds)


## IMGAPI

        "imgapi": {
            "url": "http://10.99.99.17",
            "cache": {
                "size": 5000,
                "expiry": 300
            }
        },

The `imgapi` config block tells CloudAPI how to communicate with IMGAPI, and
what cache settings to use.

**Field** | **Type** | **Description**
--------- | -------- | ---------------------------------------------------------
url       | URL      | The fully-qualified URL where IMGAPI lives
cache     | Object   | Controls the IMGAPI client cache size and the time to expire it (in seconds)


## Plugins

        "plugins": [
            {
                "name": "provision_limits",
                "enabled": false,
                "config": {
                    "defaults": [
                        {"check": "os", "os": "smartos", "value": 1},
                        {"check": "brand", "brand": "lx", "by": "ram", "value": 8192}
                    ]
                }
            }, {
                "name": "machine_email",
                "enabled": false,
                "config": {
                    "smtp": {
                        "host": "127.0.0.1",
                        "port": 25,
                        "secureConnection": false,
                        "auth": {
                            "user": "",
                            "pass": ""
                        }
                    },
                    "from": "nobody@joyent.com",
                    "subject": "Your SmartDataCenter machine is provisioning",
                    "body": "Check /my/machines for updates"
                }
            }
        ],



The `plugins` section is present so that CloudAPI can perform custom actions
**before** and **after** provisioning happens in your environment.  The
different `plugins` can define either `preProvision` hooks, `postProvision`
hooks, or both. These plugins are dynamically loaded by CloudAPI at startup
time.  For information on writing a plugin, see
[Provisioning Plugins](#provisioning-plugins).  By default, CloudAPI ships with
some example plugins to limit provisioning based on number of customer machines,
RAM used by customer machines, ...

**Field** | **Type** | **Description**
--------- | -------- | ---------------------------------------------------------
name      | String   | Name of the plugin. Assumption is that the .js file containing the plugin is at `/opt/smartdc/cloudapi/plugins/${name}.js`
enabled   | Boolean  | Whether or not this plugin should be loaded
config    | Object   | A free-form object that gets passed into your plugin at creation time


## Throttles

CloudAPI ships with a completely configurable mechanism for rate limiting
requests from tenants.  You can throttle by IP address and by username (the
former running before authentication, the latter after).  Since the different
internal services CloudAPI protects have different scaling characteristics,
CloudAPI supports throttling each API 'endpoint' separately.  The general
syntax is explained here, rather than a complete annotation of what's in the
configuration file by default.

CloudAPI uses the [Token Bucket](http://en.wikipedia.org/wiki/Token_bucket)
algorithm, and creates a separate bucket for each throttle definition. As an
example:

    "ipThrottles": {
      "all": {
        "ip": true,
        "burst": 9,
        "rate": 3,
        "overrides": {
          "10.99.99.14": {
            "burst": 0,
            "rate": 0
          }
        }
      },
      "analytics": {
        "ip": true,
        "burst": 100,
        "rate": 10,
        "overrides": {
          "10.99.99.14": {
            "burst": 0,
            "rate": 0
          }
        }
      }
    }

This configuration tells CloudAPI to create one token bucket for all endpoints,
and make it match on `ip`.  Allow a maximum burst rate of `9` requests from a
single IP (assuming there are tokens), and refill the bucket at a rate of `3`
tokens per second.  However, allow any requests coming from the portal to have
an unlimited request rate.  Now, in addition to that, because the /analytics
endpoint is likely to get polled at a high velocity (and can support the
traffic), we create a second token bucket specific to the /analytics endpoints.
Here, a single IP can burst to 100, and gets 10 tokens/second.  Again, the
portal is allowed unrestricted access.

The given keys that can be configured in the throttling configuration:

**Key**     | **Description**
----------- | ------------------------------------------------------------------
account     | /account specific throttling
analytics   | /analytics specific throttling
audit       | /audit specific throttling
config      | /config specific throttling
datacenters | /datacenters specific throttling
datasets    | /images specific throttling (originally /datasets)
keys        | /keys specific throttling
machines    | /machines specific throttling
networks    | /networks specific throttling
nics        | /nics specific throttling
packages    | /packages specific throttling
policies    | /policies specific throttling
services    | /services specific throttling
resources   | Role tagging of resources
roles       | /roles specific throttling
users       | /users specific throttling

These configurations can live in either the `ipThrottles` or `userThrottles`
section (or both).  Note that in `ipThrottles`, the type `ip` is literally
the remote connected address, so if you have placed CloudAPI behind a load
balancer/reverse-proxy, you'll literally be throttling that device, as
opposed to the end user (which probably isn't what you want).  Instead, set
the type to `xff` to throttle on the `X-Forwarded-For` header.


# Provisioning Plugins

In order to facilitate checking a customer for the ability to provision via
arbitrary systems (i.e., your favorite ERP system here), CloudAPI supports a
pre-provisioning "hook" that is invoked before CreateMachine actually calls out
to VMAPI.  Additionally, there is support for a 'post' provisioning plugin, so
that you can send emails, or update DNS records.

An assumption is that the .js file containing a plugin with name `${name}`
is at `/opt/smartdc/cloudapi/plugins/${name}.js`.

As described above, there is the ability to define a free-form configuration for
your plugin.

For details on writing a plugin, you should be familiar with
[node.js](http://nodejs.org/), [restify](https://github.com/restify/node-restify),
and the internal SmartDataCenter APIs.  For a reference plugin, see
`/opt/smartdc/cloudapi/plugins/capi_limits.js` or
`/opt/smartdc/cloudapi/plugins/machine_email.js`.

In order to write a plugin, you need to define a file that at minimum has what's
below (this is the equivalent of the "dummy" hook):

    module.exports = {

      /**
       * Creates a pre-provisioning hook.
       *
       * Config is the JS object that was converted from the
       * free-form config object that is defined in config.json.
       *
       * This function must return a restify filter that is run as part
       * of a restify "pre" chain.
       *
       * @param {Object} config free-form config from config.json.
       * @return {Function} restify 'pre' filter.
       */
      preProvision: function(config) {

        return function(req, res, next) {
          return next();
        };
      };

      /**
       * Creates a post-provisioning hook.
       *
       * Config is the JS object that was converted from the
       * free-form config object that is defined in config.json.
       *
       * This function must return a restify filter that is run as part
       * of a restify "post" chain.
       *
       * @param {Object} config free-form config from config.json.
       * @return {Function} restify 'post' filter.
       */
      postProvision: function(config) {

        return function(req, res, next) {
          return next();
        };
      };

    };

The real handiness comes in on the `req` object; CloudAPI will provide you with
the following handles:

**Handle** | Type   | Description
---------- | ------ | ----------------------------------------------------------
ufds       | Object | An UFDS client; see node\_modules/sdc-clients/lib/ufds.js for more details
vmapi      | Object | A VMAPI client; see node\_modules/sdc-clients/lib/vmapi.js for more details
napi       | Object | A NAPI client; see node\_modules/sdc-clients/lib/napi.js for more details
imgapi     | Object | A IMGAPI client; see node\_modules/sdc-clients/lib/imgapi.js for more details
account    | Object | A complete JS object of the current requested account's UFDS object
dataset    | Object | The current dataset that is attempted to be provisioned
package    | Object | The current package that is attempted to be provisioned
log        | Object | The restify logger that will let you write into the CloudAPI SMF log


Additionally, you can require in your plugin file any of the NPM modules
available for CloudAPI itself. See `/opt/smartdc/cloudapi/package.json` for
the complete list of available modules additional to the default NodeJS set.

For more information, inspect the source code of
`/opt/smartdc/cloudapi/plugins/capi_limits.js`.


# Post Provisioning Plugins

In addition to all items available to you in the `preProvision` hook, there will
additionally be a `res.machine` object, which is the provisioned machine, on the
response.

For more information, inspect the source code of
`/opt/smartdc/cloudapi/plugins/machine_email.js`.


# LogLevels

The logLevel sets the verbosity of debug logging in the SMF log file.  By
default, CloudAPI logs at the `info` level, which means you'll get start/stop
and error messages (in addition to request logging).  If you are encountering a
problem with CloudAPI, you'll almost certainly want the level to be set to
`debug` or `trace`.  See [Troubleshooting](#Troubleshooting) below.


# Troubleshooting

If you are seeing errors/bugs with the CloudAPI CLI, or with the reference
portal, you can turn on debug logging for CloudAPI in one of two ways (below).

First, you should check the log file by running:

    $ less `svcs -L cloudapi`

And looking for any indication of errors.  Note that CloudAPI logs some amount
of request information by default, and logs `WARN` level entries anytime there
is an error sent to the client (including if the error is user initiated). If
you cannot determine the problem from the default logs, turn on debug logging.


## Debug Logging in SMF

Log messages can be traced using `bunyan -p cloudapi` as explained in
[Bunyan DTrace Examples](https://github.com/trentm/node-bunyan#dtrace-examples)


# Appendix A: Provision Limits Plugin

CloudAPI comes with a **Provisioning Limits** plugin, which provides several
options for limits that CloudAPI will check before allowing the provision of a
new machine for a given customer.

Limits are either for all accounts or for a specific account. It is possible to
limit an account based on three sums: total number of account VMs, total sum of
those VMs' RAM, and/or the total sum of those VM's disk quota. Each of these
three sums can be optionally constrainted by: VM brand, VM OS (specifically, the
"os" attribute in the VM's image), and/or VM image name.

The following is the configuration fragment expected in the plugins section of
CloudAPI config file (usually set through SAPI) in order to enable and set the
different options for this plugin:


     {
          "name": "provisioning_limits",
          "enabled": true,
          "config": {
              "defaults": [{
                  "os": ${image_os} (String),
                  "image": ${image_name} (String),
                  "check": "os" | "image" (String),
                  "by": "ram" | "quota" | "machines" (String),
                  "value": ${value} (Negative Integer|Zero|Positive Integer)
              }, { ... }, ...]
          }
      }

Here are some examples of what can be added to defaults (or through UFDS,
described later):

    { "value": 200,  "by": "quota" }
    { "value": 1024, "by": "ram", "check": "os",    "os": "windows" }
    { "value": 25 }
    { "value": 100,               "check": "brand", "brand": "lx" }
    { "value": 8192, "by": "ram", "check": "image", "image": "base64-lts" }
    { "value": 50,                "check": "os",    "os": "any" }

Possible values for every config member are:

**Name**   | **Type** | **Description**         | **Possible values**
---------- | -------- | ----------------------- | ------------------------------
os         | String   | Value for Image `os`.   | Usually, this will be one of `windows`, `linux`, `smartos`, `bsd` or `any`. See [IMGAPI os values](https://github.com/joyent/sdc-imgapi/blob/master/docs/index.md#manifest-os)
image      | String   | Value for Image `name`. | This will be one of `windows`, the different `linux` flavors, different `smartos` based datasets or `any`. See [IMGAPI possible values for image names](https://github.com/joyent/sdc-imgapi/blob/master/docs/index.md#manifest-name)
check      | String   | Either "image" or "os"  | See explanation below
by         | String   | The name of the value this limit will be based on. Note that "machines" means "number of machines" | "ram", "quota", or "machines"
value      | Number   | A value for the previous "by" member | Negative Integer, Zero, or Positive Integer

Now the specifics.

Limit comes in the following JSON format:
    { "value": <number> }

Where <number> is either a number, or a 10-base string encoding of a number.
E.g. 10 or "10". 0 and -1 have special meanings: 0 means unlimited, and -1
prevents all matching provisions.

By default, a limit counts the number of VMs across a datacenter. So to set
the maximum number of VMs for an account across a datacenter to 25, use:
    { "value": 25 }

We can modify what the "value" counts by adding a "by" clause:
    { "value": <number>, "by": "<dimension>" }

Where currently-supported dimensions are "ram" (in MiB) or "quota" (in GiB).
It's possible to use something beyond "ram" and "quota" (e.g. "count"), but
that will be ignored and treated as the default: counting the number of VMs
across a datacenter; this is for compatibility with cloudapi's old plugin.

As an example, to limit the total amount of RAM an account can use across a
datacenter to 10240MiB, use the following limit:
    { "value": 10240, "by": "ram" }

It's possible to constrain a limit to specific VM brands, image names or
operating systems, instead of the entire datacenter. This is done with the
"check" attribute. It comes in three forms:
    { ..., "check": "brand", "brand": "<VM brand>" }
    { ..., "check": "image", "image": "<name of image>" }
    { ..., "check": "os", "os": "<name of image operating system>" }

So to limit the total amount of RAM used by VMs running Windows images to
8192MiB:
    { "value": 8192, "by": "ram", "check": "os", "os": "windows" }

You can use "any" in place of the image OS or name, or the VM brand. Like so:
    { "value" 25, "check": "image", "image": "any" }

"any" flags in "image" or "os" are commonly added by adminui, yet while "any"
is supported, its effect is the same as not using "check" in the first place.
E.g. these two are equivalent, both limiting the amount of disk used across
an entire datacenter to 900GiB:
    { "value": 900, "by": "quota", "check": "os", "os": "any" }
    { "value": 900, "by": "quota" }

Several limits can apply to the same account at once. All the examples above
were meant as one-liners, but adding several limits to an account will work
as desired. Each limit is applied to a new provision, and if any of the
limits, the provision is rejected.

As an example, to allow an account to have up to 25 VMs, a maximum of
25600MiB RAM and 2.5TiB disk across the datacenter, and specifically only
allow them to use 2048MiB RAM for the heretical penguin-loving Linux,
add the following four limits to the account:
    { "value": 25 }
    { "value": 25600, "by": "ram" }
    { "value": 2560, "by": "quota" }
    { "value": 2048, "by": "ram", "check": "os", "os": "other" }

There are two places that limits can be stored, and this is also reflected in
their use case:

1. sapi, both for sdc-docker and cloudapi. This is where default limits and
   categories of limits for large numbers of users are kept. These limits
   typically rarely change.
2. ufds, which is for individual accounts. These are used to add exceptions
   to the defaults and categories stored in sapi.

A typical use-case is to prevent all accounts from using more than a limited
amount of RAM of VMs across a datacenter, until their account has been vetted
by support (e.g. credit card number isn't fraudulent). After vetting, the
limit is bumped substantially. In this use-case, small limits would be set in
sdc-docker's and cloudapi's sapi configuration to serve as defaults. Once
support has vetted the account, they can add a limit in ufds for that account
to override the defaults, thus bumping the amount of RAM or VMs the account
can provision.

Limits are added to CloudAPI through sapi by adding a configuration for
this CloudAPI plugin:

    CLOUDAPI_UUID=$(sdc-sapi /services?name=cloudapi | json -Ha uuid)
    sdc-sapi /services/$CLOUDAPI_UUID -X PUT -d '{
        "metadata": {
            "CLOUDAPI_PLUGINS": "[{\"name\":\"provision_limits\", \
            \"enabled\": true,\"config\":{\"defaults\":[{\"value\":2 }]}}]"
        }
    }'

If you do this for cloudapi, you are strongly recommended to do the same for
sdc-docker:

    DOCKER_UUID=$(sdc-sapi /services?name=docker | json -Ha uuid)
    sdc-sapi /services/$DOCKER_UUID -X PUT -d '{
        "metadata": {
            "DOCKER_PLUGINS": "[{\"name\":\"provision_limits\", \
            \"enabled\": true,\"config\":{\"defaults\":[{\"value\":2 }]}}]"
        }
    }'

Looking at this plugin's configuration:
    { "defaults": [<limits>] }

Limits in "defaults" are applied to all provisions unless specifically
overridden with a ufds limit. Additional categories can be added in the
plugin's configuration, and their names are up to you. E.g.:

    {
        "defaults": [
            { "value": 2 },
            { "value": 1024, "by": "ram" }
        ]
        "small": [
            { "value": 20 },
            { "value": 10, "check": "brand", "brand": "kvm" },
            { "value": 327680, "by": "ram" },
            { "value": 2000, "by": "quota" }
        ]
        "whale": [
            { "value": 10000 },
            { "value": 327680000, "by": "ram" },
            { "value": 1000000, "by" :"quota" }
        ]
    }

The above configuration has defaults which are applied to all accounts that
do not have a category set in "tenant" (see below). There are two added
category of users: "small" and "whale". The "small" category allows accounts
to have up to 20 VMs, up to 10 KVM instances, and a total of 320GiB RAM and
2000GiB disk across the datacenter. The "whale" category is much, much
higher.

Which category an account falls in is determined by the "tenant" attribute on
that account in ufds. If the attribute is blank or absent (or a category
that doesn't exist in the configuration), the account uses "defaults" limits.
If the attribute is present and matches a category in the plugin
those are the limits used. For example, this account is a whale:

    $ sdc-ufds search '(login=megacorp)' | json tenant
    whale

To override any of these defaults or categories in ufds, add a capilimit
entry. It takes the general form of:

    sdc-ufds add '
    {
      "dn": "dclimit=$DATACENTER, uuid=$ACCOUNT_UUID, ou=users, o=smartdc",
      "datacenter": "$DATACENTER",
      "objectclass": "capilimit",
      "limit": ["<JSON limit>", "<JSON limit>", ...]
    }'

One last, more complete, config example:

> *Disallow provisioning any windows machine. For any other OS, allow
> provisioning machines until RAM reaches a limit of 51200.*

    "plugins": [
        {
            "name": "provision_limits",
            "enabled": true,
            "config": {
                "defaults":[{
                   "by": "ram",
                   "value": 51200
                }, {
                   "check": "os",
                   "os": "windows",
                   "value": -1
                }]
            }
        },


### Adding limits using UFDS:

The following is an example of adding provisioning limits using ufds:

    sdc-ldap add << EOD
    dn: dclimit=coal, uuid=cc71f8bb-f310-4746-8e36-afd7c6dd2895, ou=users, o=smartdc
    datacenter: coal
    objectclass: capilimit
    limit: {"os": "smartos", "check": "os", "by": "ram", "value": "8192"}
    limit: {"os": "any", "check": "os", "value": "4"}
    EOD

You can also modify existing capilimit entries. The following would modify an
entry, add some extra limits to the customer:

    sdc-ldap modify << EOD
    dn: dclimit=coal, uuid=d7425eee-bbb1-4abf-b2b8-95ac1eee832f, ou=users, o=smartdc
    changetype: modify
    add: limit
    limit: {"os": "smartos", "check": "os", "by": "ram", "value": "8192"}
    -
    add: limit
    limit: {"os": "any", "check": "os", "value": "4"}
    EOD

<p style="min-height: 31px; margin-top: 60px; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 10px 0">
<a rel="license" href="http://creativecommons.org/licenses/by-nd/3.0/"><img alt="Creative Commons License" style="border-width:0;float:left;margin:4px 8px 0 0;" src="https://i.creativecommons.org/l/by-nd/3.0/88x31.png" /></a> <span xmlns:dct="http://purl.org/dc/terms/" href="http://purl.org/dc/dcmitype/Text" property="dct:title" rel="dct:type">Joyent CloudAPI Administrator's Guide</span> by <a xmlns:cc="http://creativecommons.org/ns#" href="http://www.joyent.com" property="cc:attributionName" rel="cc:attributionURL">Joyent, Inc.</a> is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-nd/3.0/">Creative Commons Attribution-NoDerivs 3.0 Unported License</a>.
</p>
