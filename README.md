# Joyent CloudAPI

Repository: <git@git.joyent.com:cloudapi.git>
Browsing: <https://mo.joyent.com/cloudapi>
Who: Mark Cavage, Pedro Palazón Candel et others.
Docs: <https://mo.joyent.com/docs/cloudapi/master/>
Tickets/bugs: <https://devhub.joyent.com/jira/browse/PUBAPI>


# Overview

CloudAPI is the API that customers use to interact with SmartDataCenter product

# Adding CloudAPI zone to SDC 7.0

`cloudapi` zone is not created by default as a core zone. If your setup lacks
of cloudapi zone, you can create it by running:

    sdc-sapi /instances -X POST \
    -d "{\"service_uuid\": \"$(sdc-sapi --no-headers /services?name=cloudapi | json -a uuid)\", \"params\": { \"alias\" : \"cloudapi0\" }}"

# Development

To run the CloudAPI server:

    git clone git@git.joyent.com:cloudapi.git
    cd cloudapi
    git submodule update --init
    make all
    node main.js -f ./etc/cloudapi.config.json 2>&1 | bunyan

Before commiting/pushing run `make prepush` and, if possible, get a code
review.

# Configuration file.

The configuration file `./etc/cloudapi.cfg` needs to be created before
the CloudAPI server can run. Consequently, **this file is also required in
order to run the test suite**.

There is an example `cloudapi.coal.cfg` file checked into the repository, with
the default values every required variable should take if we were running the
tests into our development machine, which has access to a COAL setup.

The file `cloudapi.cfg.in` is used by headnode setup to replace every variable
by the proper values required to make CloudAPI to work for real into a given
SDC setup.

The following is a list of the required variables, all included into this file,
and their expected values:

      "port": 443,
      "certificate": "/opt/smartdc/cloudapi/ssl/cert.pem",
      "key": "/opt/smartdc/cloudapi/ssl/key.pem",

These are pretty straightforward, port where the application HTTP server should
listen to and, in case of HTTPS, path to certificate & key. 

      "ufds": {
          "url": "UFDS_URL",
          "bindDN": "UFDS_ROOT_DN",
          "bindPassword": "UFDS_ROOT_PW",
          "cache": {
              "size": 5000,
              "expiry": 60
          }
      },

The UFDS section. It should include the __complete__ ldap(s) address for UFDS,
and the required DN and password to bind to the LDAP server.

      "vmapi": {
          "url": "VMAPI_URL",
          "cache": {
              "size": 5000,
              "expiry": 60
          }
      },

VMAPI section. Right now internal APIs will not provide HTTP Basic Auth.
`VMAPI_URL` must be the __complete__ HTTP address for VMAPI's HTTP server
running into vmapi zone.

      "wfapi": {
          "url": "WFAPI_URL",
          "cache": {
              "size": 1000,
              "expiry": 300
          }
      },

Same than the VMAPI section, but for Workflow API.

      "napi": {
          "url": "NAPI_URL",
          "cache": {
              "size": 5000,
              "expiry": 300
          }
      },

Same than the VMAPI section, but for NAPI.

      "cnapi": {
          "url": "CNAPI_URL",
          "cache": {
              "size": 5000,
              "expiry": 300
          }
      },

Same than the VMAPI section, but for CNAPI.

      "fwapi": {
          "url": "FWAPI_URL",
          "cache": {
              "size": 5000,
              "expiry": 300
          }
      },

Same than the VMAPI section, but for FWAPI.

      "imgapi": {
          "url": "IMGAPI_URL",
          "cache": {
              "size": 5000,
              "expiry": 300
          }
      },

And the same thing for IMGAPI. We are using local IMGAPI instance.

      "ca": {
          "url": "CA_URL"
      },

The Cloud Analytics section. Like always, where we say URL we mean __complete__.

      "datacenters": {
          "DATACENTER_NAME": "CLOUDAPI_EXTERNAL_URL"
      },

The name of this datacenter, and the URL we can use to access CLOUDAPI from the
outside world, if any.


# Testing

Before testing, you need to import smartos-1.6.3 dataset as follows from the
headnode:

    /opt/smartdc/bin/sdc-imgadm import \
    -m /usbkey/datasets/smartos-1.6.3.dsmanifest \
    -f /usbkey/datasets/smartos-1.6.3.zfs.bz2

(Note you can also scp the file `tools/coal-setup.sh` and run it on the headnode,
which will create the CloudAPI zone and import the aforementioned dataset).

    make test

or, individually:

    make account_test
    make auth_test
    make datacenters_test
    make datasets_test
    make keys_test
    make machines_test
    make networks_test
    make packages_test

Optimistic, isn't it?. Reality is that, while it may works, that command
includes a set of assumptions which may or not be satisfied by the environment
you are trying to run tests into.

There are some requirements to run the test suites, in the form of environment
variables. The following is a list of these variables and their default values:

- `LOG_LEVEL`: Tests log level. Default `info`.
- `POLL_INTERVAL`: Value used to check for a vm status change, in milisecs.
  By default, 500 miliseconds.
- `SDC_SETUP_TESTS`: The tests are running versus an existing SDC setup. (No
need to boot a server instance, since there's one already running).

Also, the contents of the aforementioned `./etc/cloudapi.cfg` file
should have been properly set.

# COAL headnode provisinability

For testing changes on a COAL headnode-only configuration you will need to
set the `SERVER_UUID` environment variable in the SMF manifest for the cloudapi
service. This should be the UUID of the headnode which can be found through

    sysinfo | json UUID

this should be placed in the `method_environment` subsection of the start
method in the SMF manifest. For instance:

    <envvar name='SERVER_UUID' value='564dafc4-73fa-b009-ce16-c93e487fbaa6'/>

To edit the SMF manifest:

    svccfg export cloudapi > cloudapi.xml
    ... edit service ...
    svccfg import cloudapi.xml
    svcadm restart cloudapi


