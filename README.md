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

    ./tools/add-cloudapi-zone.sh <ssh hostname>

from your development machine. For example, assuming you have an entry into
your computer's SSH config file for COAL's headnode with `Host` set to
`headnode`, the command above would become:

    ./tools/add-cloudapi-zone.sh headnode

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

Please, remember that if you're trying to modify this file within a cloudapi
zone, the config file is created - and automatically updated - by the
`config-agent` service using the `template` file checked into this repo
(`sapi_manifests/cloudapi/template`) and the SAPI configuration values.


# Testing

Before testing, you need to import base image and create some packages into the
headnode you're using for tests. Assuming that you'll be testing using COAL's
Headnode and that you've already created `cloudapi0` zone into such HN, the
easier way to prepare the Headnode for CloudAPI testing will be running, from
the Global Zone:

    /zones/`vmadm lookup -1 alias=cloudapi0`/root/opt/smartdc/cloudapi/tools/coal-setup.sh

This script will hack DAPI for Headnode provisioning, update imgapi to allow
local custom images and install `base-13.4.0` and `smartos-1.6.3` images
required for testing.

Once you've completed this process you can run:

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

# COAL headnode provisionability

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

# Image management

If you want to test image management using COAL, the faster approach is to run
the aforementioned coal-setup.sh script from the global zone. Among others, local
image management setup will be completed.
