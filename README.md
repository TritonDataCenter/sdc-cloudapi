<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright 2018, Joyent, Inc.
-->

# sdc-cloudapi

This repository is part of the Joyent Triton project. See the [contribution
guidelines](https://github.com/joyent/triton/blob/master/CONTRIBUTING.md) --
*Triton does not use GitHub PRs* -- and general documentation at the main
[Triton project](https://github.com/joyent/triton) page.

CloudAPI is the HTTP API that customers use to interact with SmartDataCenter.


## Adding CloudAPI to SDC

`cloudapi` is not created by default during SDC setup. You can create it
by running in the root global zone (either inside COAL or on an SDC headnode
server):

    sdcadm post-setup cloudapi


## Development

A CloudAPI server should be running in a cloudapi zone after running the
sdcadm command above. Alternatively, a more manual approach is:

    git clone git@github.com:joyent/sdc-cloudapi.git
    cd sdc-cloudapi
    git submodule update --init
    make all
    node main.js -f ./etc/cloudapi.config.json


## Configuration file.

The configuration file `./etc/cloudapi.cfg` needs to be created before
the CloudAPI server can run. Consequently, **this file is also required in
order to run the test suite**.

There is an example `cloudapi.coal.cfg` file in the repository, with the
default values every required variable should take if we were running the
tests on our development machine, which has access to a COAL setup.

Please remember that if you're trying to modify this file within an actual
cloudapi zone, the config file is created - and automatically updated - by the
`config-agent` service using the `template` file also in this repo
(`sapi_manifests/cloudapi/template`) and the SAPI configuration values.


## Testing

Before testing, you need to create an environment the tests can operate in,
on the headnode you're using for tests. Assuming that you'll be testing using
COAL's headnode, and that you've already created a cloudapi zone on that
headnode, the easiest way to prepare the headnode for CloudAPI testing will be
running the following from the global zone:

    /zones/`vmadm lookup -1 alias=cloudapi0`/root/opt/smartdc/cloudapi/tools/coal-setup.sh

This script will hack DAPI for headnode provisioning, update imgapi to allow
local custom images, and install some services, images packages required for
thorough testing.

Once you've completed this process, run the following from within the cloudapi
zone:

    ./test/runtests

The `runtests` script does a safety check for a canary file before attempting
to run any tests, to prevent unwanted writes. If the canary is not found,
`runtests` will let you know; create (e.g. using touch) the file and rerun
`runtests`.

To run a specific test file, and not the entire test suite, use the -f flag
with runtests. For example:

    ./test/runtests -f nics.test.js

This will run test/nics.test.js. If you want to run multiple test files, -f
effectively globs too:

    ./test/runtests -f machines

This will run all the machines\* test files in test/.

It is possible to run the test suite outside of a cloudapi zone, but this is
an increasingly unbeaten path. If you are so inclined, then ensure that
`./etc/cloudapi.cfg` is set up appropriately and execute:

    make test

But your life will be simpler if you stick to a cloudapi zone and use the
`runtests` script; various config settings and environmental flags are set by
`runtests` automatically.


## Image management

If you want to test image management using COAL, the faster approach is to run
the aforementioned coal-setup.sh script from the global zone. Amongst other
things, local image management setup will be completed.


## Testing RBAC

This section assumes your setup includes a reasonably recent version of
UFDS and Mahi. If you're not sure, please update both to latest.

There's an utility script intented to speed up ENV setup for RBAC testing
in your local setup. Assuming you want to test RBAC in COAL, you'll need to:

- Setup CloudAPI zone (see above).

- Add the account `account` and the user `user`, both with password
`joypass123`, and both of them using the SSH key `~/.ssh/id_rsa.pub`:

    ./tools/create-account.sh headnode

- Clone v7.3 or later branch of node-smartdc from https://github.com/joyent/node-smartdc
- Assuming you want to test in COAL, you should have the following ENV vars
  setup to operate as the account owner:

        SDC_URL=https://<IP of cloudapi zone>
        SDC_TESTING=true
        SDC_ACCOUNT=account
        SDC_KEY_ID=`ssh-keygen -l -E md5 -f ~/.ssh/id_rsa.pub| awk '{print $2}' | tr -d '\n'|cut -c 5-`

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

[cloudapi]: https://apidocs.joyent.com/cloudapi/
[acuguide]: https://docs.joyent.com/jpc/rbac


## How CloudAPI Auth works using RBAC

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
