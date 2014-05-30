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

NOTE: If this scripts finishes properly and "really fast for being creating a
VM", you'd rather take a look and make sure SAPI is not in proto mode. If
that's the case, you can always set it to full mode from the GZ before you
retry: `sdc-sapi /mode?mode=full -X POST`.

# Testing RBAC

This section assumes your setup includes a reasonably recent version of
UFDS and MAHI. If you're not sure, please, update both to latest.

There's an utility script intented to speed up ENV setup for RBAC testing
in your local setup. Assuming you want to test RBAC in COAL, you'll need to:

- Setup CloudAPI zone (see above).
- Update config to enable account management:

    /zones/`vmadm lookup -1 \
    alias=cloudapi0`/root/opt/smartdc/cloudapi/bin/enable-account-mgmt

- Add the account `account` and the user `user`, both with password
`joypass123`, and both of them using the SSH key `~/.ssh/id_rsa.pub`:

    ./tools/create-account.sh headnode

- Clone v7.3 branch of node-smartdc from https://github.com/joyent/node-smartdc/tree/v7.3
- Assuming you want to test in COAL, you should have the following ENV
vars setup to operate as the account owner:

        SDC_URL=https://10.99.99.38
        SDC_TESTING=true
        SDC_ACCOUNT=account
        SDC_KEY_ID=`ssh-keygen -l -f ~/.ssh/id_rsa.pub | awk '{print $2}' | tr -d '\n'`

And, in order to operate as the account user instead, you just need to add the
ENV var:

        SDC_USER=user

given we already created both with the same SSH key/fingerprint.

If you want to also test machines creation and the associated actions, you'll
need to hack the setup the same way we do for testing:

    /zones/`vmadm lookup -1 \
    alias=cloudapi0`/root/opt/smartdc/cloudapi/tools/coal-setup.sh

For more information on RBAC you can check [CloudAPI docs][cloudapi] and
the [Access Control User Guide][acuguide].

[cloudapi]: https://mo.joyent.com/docs/cloudapi/master/
[acuguide]: https://mo.joyent.com/docs/engdoc/master/rbac/index.html

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


# How CloudAPI Auth works using RBAC

Roles and Policies are used in CloudAPI to provide access control for accounts'
sub users. Authorization for account sub users is always made using HTTP
Signature. The following is a brief description of CloudAPI access control
process for sub users (all of this assuming `account_mgmt` feature is enabled
and `req.version >= 7.2.0`):

### Identify request resource

CloudAPI identifies the `name` of the `resource` for the request. This can
be either a collection of resources or an individual one. While this usually
matches the request path, it's not always true. For example:

  a. `ListFirewallRules`: Firewal Rules Resource Collection: `/:account/fwrules`.
  b. `GetFirewallRule`: Individual Firewall Rule Resource: `/:account/fwrules/:fwruleid`
  c. `EnableFirewallRule`: The same individual firewall Rule resource than for
  `GetFirewallRule`, identified by `/:account/fwrules/:fwruleid` even when the
  path for this request would be `/:account/fwrules/:fwruleid/enable`.

It's to say, for a given individual resource, all actions happening over this
resource will share the `name` which is the path for the main `GetResource`
request. For example, every action listed under the `Machines` epigraph in
CloudAPI docs related to an individual machine will have the same resource,
*"the machine"*, identified by `/:account/machines/:machineid`, even when these
actions could be rename machine, enable firewall, add tags, create snapshot,
audit ...

### Load resource role-tags when exist

Once the `name` of the `resource` for the current request has been identified,
CloudAPI checks if there are any `role-tag` associated with the current resource.

(`role-tag`s are just a set of one or more roles associated with the current
resource. CloudAPI customers can associate `role-tag` to resources using the
names of the roles they want to provide some kind of access to the resource.)

`role-tag` loading is done differently depending if the current resource is an
individual machine (given machines store `role-tag` by themselves) or something
else. Everything but machines uses UFDS' `sdcAccountResource` objectclass,
which has the following attributes:

    dn: resource-uuid=:resource_uuid, uuid=:account_uuid, ou=users, o=smartdc
    account: account_uuid
    memberrole: [aRoleDN, anotherRoleDN, ...]
    name: :resource_name
    objectclass: sdcaccountresource
    uuid: :resource_uuid

Behind the scences, CloudAPI *"translates"* the role DNs into their respective
role objects.

For machines, given each machine may have a `role_tag` member in VMAPI, which
is an array of roles' UUIDs, CloudAPI does exactly the same regarding role
translation from UUID into the collection of role objects.

(Please, note that, in order to be able to use machine `role-tag` to handle
sub-user auth, we need to preload machine loading for all the machine related
requests).

In both cases, our request object will have the following properties:

    req.resourcename = :resource_name
    req.resource = {
        name: req.resourcename,
        account: req.account.uuid,
        roles: [[ {role_object}[ , {role_object}, ... ] ]]
    };

### Ask MAHI to authorize/deny user access

When CloudAPI detects that the current request is being performed by an account
sub-user, it will load the sub-user active roles (i.e. `user.default_roles`), and
will pass those, together with the current resource roles collected into the
previous step,  to `aperture` for user authorization. Additionally, the current
request `path`, `method` and `route name` are also given to aperture.

What needs to happen for the user to get access to the current resource then?:

a. The user must have at least one of the roles assigned to the resource.
b. For these roles, at least one of the policies associated with them must have
a rule which allows the current request method for the given route name, for
example: `CAN get AND head IF route::string = listusers`
