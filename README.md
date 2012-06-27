# Joyent CloudAPI

Repository: <git@git.joyent.com:cloudapi.git>
Browsing: <https://mo.joyent.com/cloudapi>
Who: Mark Cavage, Pedro Palazón Candel et others.
Docs: <https://mo.joyent.com/docs/cloudapi/master/>
Tickets/bugs: <https://devhub.joyent.com/jira/browse/PUBAPI>


# Overview

CloudAPI is the API that customers use to interact with SmartDataCenter product



# Development

To run the CloudAPI server:

    git clone git@git.joyent.com:cloudapi.git
    cd cloudapi
    git submodule update --init
    make all
    node -f ./etc/cloudapi.config.json 2>&1 | bunyan

Before commiting/pushing run `make prepush` and, if possible, get a code
review.



# Testing

    make test

or, individually:

    make account_test
    make datacenters_test
    make datasets_test
    make keys_test
    make machines_test
    make packages_test

Optimistic, isn't it?. Reality is that, while it may works, that command
includes a set of assumptions which may or not be satisfied by the environment
you are trying to run tests into.

There are some requirements to run the test suites, in the form of environment
variables. The following is a list of these variables and their default values:

- `CLOUDAPI_URL`: Complete URL to Cloud API server, where _complete_ means
  protocol included. Default value: `http://localhost:8080`
- `LOG_LEVEL`: Tests log level. Default `info`.
- `UFDS_URL`: Complete URL to UFDS ldap server, where _complete_, again, means
  protocol included. Default value: `ldaps://10.99.99.13`, (the default COAL
  ip for the ufds zone).

## Other test related env vars:

- `POLL_INTERVAL`: Value used to check for a vm status change, in milisecs.
  By default, 500 miliseconds.

# TODO

Remaining work for this repo:

- Make it work with SDC 7.0, providing same API than 6.5 did.
- New 7.0 version of the API, once we're done with the previous task.

