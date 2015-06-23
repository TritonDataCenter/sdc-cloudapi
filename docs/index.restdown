---
title: Joyent CloudAPI
mediaroot: ./media
apisections: Account, Keys, Config, Datacenters, Datasets, Images, Packages, Machines, Analytics, FirewallRules, Networks, Nics, Users, Roles, Policies, Services, User SSH Keys, Role Tags, Fabrics
markdown2extras: wiki-tables, code-friendly
---
<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2015, Joyent, Inc.
-->

# Joyent CloudAPI

CloudAPI is the public API for a SmartDataCenter cloud: it allows operations
on VMs, networking, users, datasets, and other relevant details for the running
of machinery in a SmartDataCenter cloud.

This is the reference documentation for the CloudAPI that is part of Joyent's
SmartDataCenter 7.0 product.  This guide provides descriptions of the APIs
available, as well as supporting information -- such as how to use the SDK(s),
command line interface (CLI), and where to find more information.

For more information about this product visit
[Joyent SmartDataCenter](http://www.joyent.com/software/smartdatacenter).

This document refers to SmartDataCenter 7.0.  For information on version 6.5 of
this API see [CloudAPI 6.5 Documentation](65.html)


## Conventions

Any content formatted as follows is a command-line example that you
can run from a shell:

    $ sdc-listmachines

All other examples and information are formatted like so:

    GET /my/machines HTTP/1.1




# Introduction to CloudAPI

## What is CloudAPI?

CloudAPI is the API you use to interact with the SmartDataCenter product.  Using
CloudAPI, you can:

* Provision new machines (both SmartMachines and traditional Virtual Machines)
* Manage your account credentials
* Create custom analytics for monitoring your infrastructure


## How do I access CloudAPI?

CloudAPI is available as a REST API, and you can access it using:

* SmartDataCenter Customer Portal
* [Command line interface](https://github.com/joyent/node-smartdc) (CLI)
* [node.js SDK](https://github.com/joyent/node-smartdc)
* REST API

If you don't want to write any code, use the CloudAPI CLI.  The CLI lets you use
command-line tools to perform every action available in the SDK and REST API.




# Getting Started

If you choose to use the CloudAPI command line interface (CLI), be aware that it
requires Node.js and npm.

You can get Node.js from [nodejs.org](http://nodejs.org) as source code, and as
precompiled packages for Windows and Macintosh.  It should be greater or equal
than v0.8.14, so npm should come with it as well.

Once you've installed Node.js and npm, install the CloudAPI CLI as follows:

    $ npm install smartdc -g

You will also want to install [json](https://www.npmjs.org/package/json), a tool
that makes it easier to work with JSON-formatted output.  You can install it
like this:

    $ npm install json -g

In both cases the `-g` switch installs the tools globally, usually in
`/usr/local/bin`, so that you can use them easily from the command line.  You
can omit this switch if you'd rather the tools be installed in your home
hierachy, but you'll need to set your PATH appropriately.


## Generate an SSH key

The CloudAPI CLI does not allow you to use HTTP Basic Authentication, as that is
a weak security mechanism.  Furthermore, to interact with the provisioned
machines themselves, you need an SSH key to login.

If you haven't already generated an SSH key (required to use both SSH and HTTP
Signing), run the following command:

    $ ssh-keygen -b 2048 -t rsa

This will prompt you with a place to save the key.  You should probably just
accept the defaults, as many programs (SSH and SDC CLI) will first look for a
file called ~/.ssh/id_rsa.


## Set Up your CLI

You need to know the following information in order to interact with CloudAPI:

* `SDC_ACCOUNT`: Your username.  The login you use for SDC.
* `SDC_USER`: The account subuser when you are using
  [Role Based Access Control](#rbac-users-roles-policies).
* `SDC_URL`: The URL of the CloudAPI endpoint.
* `SDC_KEY_ID`: Fingerprint for the key you uploaded to SmartDC through portal.

An example for `SDC_URL` is `https://us-west-1.api.joyentcloud.com`.  Each
datacenter in a cloud has its own CloudAPI endpoint; a different cloud that uses
SmartDataCenter would have a different URL.

In this document, we'll use `api.example.com` as the `SDC_URL` endpoint; please
replace it with the URL of your DC(s).  Note that CloudAPI always uses secure
HTTP, which means that the endpoint URL must begin with `https`.

You can quickly get your key fingerprint for `SDC_KEY_ID` by running:

    $ ssh-keygen -l -f ~/.ssh/id_rsa.pub | awk '{print $2}' | tr -d '\n'

where you obviously replace `~/.ssh/id_rsa.pub` with the path to the public key
you want to use for signing requests.


## Working with the CLI

For a complete list of CloudAPI CLI commands available, please see
[Appendix D: CloudAPI CLI Commands](#appendix-d-cloudapi-cli-commands).

To get help on command, use the `--help` flag.  For example:

    $ sdc-listdatacenters --help
    sdc-listdatacenters [--account string] [--debug boolean] [--help boolean] [--keyId string] [--url url]

You can set environment variables for the following flags so that you don't have
to type them for each request (e.g. in your .bash_profile).  All the examples in
this document assume that these variables have been set:

|| **CLI Flags** || **Description** || **Environment Variable** ||
||--account<br/>-a||Login name (account)||SDC\_ACCOUNT||
||--user||Subuser name when using [Role Based Access Control](#rbac-users-roles-policies)||SDC\_USER||
||--keyId<br/>-k||Fingerprint of the key to use for signing||SDC\_KEY\_ID||
||--url<br/>-u||URL of the CloudAPI endpoint||SDC\_URL||

You can use the short form of flags as well.  For instance, you can use the `-a`
or `--account` flag.


## Provision a new machine

To provision a new machine, you first need to get the `id`s for the image and
package you want to use as the base for your machine.

An image is a snapshot of a filesystem and its software (for SmartMachines),
or a disk image (for Virtual Machines).  You can get the list of available
images using the `sdc-listimages` command; see the [ListImages](#ListImages)
section below for a detailed explanation of this command.

A package is a set of dimensions for the new machine, such as RAM and disk size.
You can get the list of available packages using the `sdc-listpackages` command;
see the [ListPackages](#ListPackages) section below for a detailed explanation
of this command.

Once you have the package and image ids, to provision a new machine:

    $ sdc-createmachine --name=getting-started --image=c3321aac-a07c-11e3-9430-fbb1cc12d1df --package=9fcd9ab7-bd07-cb3c-9f9a-ac7ec3aa934e
    {
      "id": "4adf88fb-ba7e-c4b1-a017-b988f510cbc2",
      "name": "getting-started",
      "type": "smartmachine",
      "state": "provisioning",
      "image": "c3321aac-a07c-11e3-9430-fbb1cc12d1df",
      "ips": [],
      "memory": 256,
      "disk": 16384,
      "metadata": {
        "root_authorized_keys": "..."
      },
      "tags": {},
      "created": "2014-05-28T10:12:38.329Z",
      "updated": "2014-05-28T10:12:38.329Z",
      "networks": [],
      "dataset": "sdc:sdc:base64:13.4.1",
      "firewall_enabled": false,
      "compute_node": null,
      "package": "g3-devtier-0.25-smartos"
    }

You can use the `--name` flag to name your machine; if you do not specify a
name, SmartDataCenter will generate one for you.  `--image` is the `id` of the
image you'd like to use as the new machine's base.  `--package` is the `id` of
the package to use to set machine dimensions.

Retrieve the status of your new machine by:

    $ sdc-listmachines --name=getting-started
    [
      {
        "id": "4adf88fb-ba7e-c4b1-a017-b988f510cbc2",
        "name": "getting-started",
        "type": "smartmachine",
        "state": "running",
        "image": "c3321aac-a07c-11e3-9430-fbb1cc12d1df",
        "ips": [
          "165.225.138.124",
          "10.112.2.89"
        ],
        "memory": 256,
        "disk": 16384,
        "metadata": {
          "root_authorized_keys": "..."
        },
        "tags": {},
        "created": "2014-05-28T10:15:33.301Z",
        "updated": "2014-05-28T10:16:50.000Z",
        "networks": [
          "65ae3604-7c5c-4255-9c9f-6248e5d78900",
          "56f0fd52-4df1-49bd-af0c-81c717ea8bce"
        ],
        "dataset": "sdc:sdc:base64:13.4.1",
        "primaryIp": "165.225.138.124",
        "firewall_enabled": false,
        "compute_node": "44454c4c-3800-104b-805a-b4c04f355631",
        "package": "g3-devtier-0.25-smartos"
      }
    ]

When you provision a new machine, the machine will take time to be initialized
and booted; the `state` attribute will reflect this.  Once the `state` attribute
in the JSON from `sdc-listmachines` is "running", you can login to your new
machine (assuming it's a Unix-based machine), with the following:

    $ ssh-add ~/.ssh/id_rsa
    $ ssh -A admin@165.225.138.124

Replace `~/.ssh/id_rsa` with the path to the key you added in the portal, and
`165.225.138.124` with the IP of your new machine.

These two commands set up your SSH agent (which has some magical properties,
such as the ability for the CLI to work on your SmartMachine without keys), and
logs you in as the `admin` user on that machine.  Note that the `admin` user has
password-less sudo capabilities, so you may want to set up some less priviledged
users.  The SSH keys on your account will allow you to login as `root` or
`admin` on your SmartMachine.

Now that we've done some basics with a machine, let's introduce a few concepts:


<a name="image-description"></a>
### Images

By default, you can use SmartOS images.  Your SmartDataCenter cloud may have
other images available as well, such as Linux or Windows images.  The list of
available images can be obtained with:

    $ sdc-listimages

The main difference with (older) datasets is that images will not provide an
URN, but just a unique id which must be used to identify your image of choice.


<a name="packages-description"></a>
### Packages

You can list packages available in your cloud with:

    $ sdc-listpackages
    [
      {
        "name": "g3-standard-8-smartos",
        "memory": 8192,
        "disk": 807936,
        "swap": 16384,
        "lwps": 2000,
        "vcpus": 0,
        "default": false,
        "id": "28d8c3f1-cf62-422a-a41d-fdf8b5110d00",
        "version": "1.0.0",
        "description": "Standard 8 GB RAM 2 vCPUs and bursting 789 GB Disk",
        "group": "Standard"
      },
      ...
    ]

Packages are the SmartDataCenter name for the dimensions of your machine.
Packages are provided so that you do not need to select individual settings,
such as RAM or disk size.  To provision a new SmartMachine with more memory than
the one your created above, try:

    $ sdc-createmachine --name=big-one --image=3390ca7c-f2e7-11e1-8818-c36e0b12e58b --package=28d8c3f1-cf62-422a-a41d-fdf8b5110d00

Please note this example assumes that the package and image `id`s above exist in
the SmartDataCenter setup you are interacting with.  That may or not be the
case, given that packages and image may change from one setup to another.  Just
make sure you try the previous example with an existing package and image `id`s
from those you obtained using `sdc-listpackages` and `sdc-listimages`
respectively.


## Managing SSH keys

For machines of `type` `smartmachine` (see the JSON returned from
`sdc-listmachines`), you can manage the SSH keys that allow logging into the
machine via CloudAPI (Virtual Machines are static, and whatever keys were in
your account at machine creation time are used).  For example, to rotate keys:

    $ sdc-createkey --name=my-other-rsa-key ~/.ssh/my_other_rsa_key.pub

The `--name` option sets the name of the key.  If you don't provide one,
CloudAPI sets it to the name of the file; in this case `my_other_rsa_key.pub`.

To use the new key, you will need to update the environment variables:

    $ export SDC_KEY_ID=`ssh-keygen -l -f ~/.ssh/my_other_rsa_key.pub | awk '{print $2}' | tr -d '\n'`

At this point you could delete your other key from the system; see
[Cleaning Up](#cleaning-up) for a quick example.


## Creating Analytics

Now that you have a SmartMachine up and running, and you logged in and did
whatever it is you thought was awesome, let's create an instrumentation to
monitor performance.  Analytics are one of the most powerful features of
SmartDataCenter, so for more information, be sure to read
[Appendix B: Cloud Analytics](#appendix-b-cloud-analytics).

To get started, let's create an instrumentation on our network bytes:

    $  sdc-createinstrumentation --module=nic --stat=vnic_bytes
    {
      "module": "nic",
      "stat": "vnic_bytes",
      "predicate": {},
      "decomposition": [],
      "value-dimension": 1,
      "value-arity": "scalar",
      "enabled": true,
      "retention-time": 600,
      "idle-max": 3600,
      "transformations": {},
      "nsources": 0,
      "granularity": 1,
      "persist-data": false,
      "crtime": 1401278156130,
      "value-scope": "interval",
      "id": "1",
      "uris": [
        {
          "uri": "/.../analytics/instrumentations/1/value/raw",
          "name": "value_raw"
        }
      ]
    }

Great, now ssh back into your machine, and do something silly like:

    $ wget joyent.com
    $ ping -I 1 joyent.com

Back on your CLI, go ahead and run:

    $ sdc-getinstrumentation 1
    {
      "module": "nic",
      "stat": "vnic_bytes",
      "predicate": {},
      "decomposition": [],
      "value-dimension": 1,
      "value-arity": "scalar",
      "enabled": true,
      "retention-time": 600,
      "idle-max": 3600,
      "transformations": {},
      "nsources": 0,
      "granularity": 1,
      "persist-data": false,
      "crtime": 1401278293816,
      "value-scope": "interval",
      "id": "2",
      "uris": [
        {
          "uri": "/marsell/analytics/instrumentations/2/value/raw",
          "name": "value_raw"
        }
      ]
    }

Where `1` is the id you got back from `sdc-createinstrumentation`.  You should
be able to run this a few times and see the changes.  This is just a starting
point, for a full discussion of analytics, be sure to read
[Appendix B: Cloud Analytics](#appendix-b-cloud-analytics).


## Cleaning up

After going through this `Getting Started` section, you should now have at least
one SSH key, one machine and one instrumentation.  The rest of the commands
assume you have [json](https://www.npmjs.org/package/json) installed.

### Deleting Instrumentations

Before cleaning up your machines, let's get rid of the instrumentation we
created:

    $ sdc-deleteinstrumentation 1

### Deleting Machines

Machines need to be shutdown before you can delete them, so let's do some fancy
shell work to do that:

    $ sdc-listmachines -n getting-started | json 0.id | xargs sdc-stopmachine

Now go ahead and check the state a few times until it's `stopped`, then run
`sdc-deletemachine`:

    $ sdc-listmachines -n getting-started | json 0.state
    $ sdc-listmachines -n getting-started | json 0.id | xargs sdc-deletemachine

### Deleting keys

Finally, you probably have one or two SSH keys uploaded to SmartDataCenter after
going through the guide, so delete the one we setup:

    $ sdc-deletekey id_rsa


## RBAC: Users, Roles & Policies.

Starting at version 7.2.0, CloudAPI supports Role Based Access Control (RBAC),
which means that [accounts](#account) can have multiple users and
roles associated with them.

While the behaviour of the [main account](#GetAccount) remains the same,
including the [SSH keys](#keys) associated with it, it's now possible to have
multiple [Users](#users) subordinate to the main account.  Each of these
users have a different set of [SSH Keys](#sshKeys).  Both the users and their
associated SSH keys have the same format as the main account object (and the
keys associated with it).

It's worth mentioning that the `login` for an account's users must be different
only between the users of that account, not globally.  We could have an account
with login *"mark"*, another account "exampleOne" with a user with login "mark",
another account "exampleTwo" with another user with login "mark", and so
forth.

These account users can additionally be organized using [Roles](#roles):

    {
        id: '802fbab6-ec2b-41c3-9399-064ccb65075b',
        name: 'devs',
        members: [ 'bob', 'fred', 'pedro' ],
        default_members: [ 'bob', 'fred' ],
        policies: [ 'createMachine', 'resizeMachine', 'CreateImageFromMachine']
    }

Each role can have an arbitrary set of [Policies](#policies):

    {
        id: '9d99a799-8234-4dd8-b37d-9af14b96da25',
        name: 'restart machines',
        rules: [ 'CAN rebootmachine if requesttime::time > 07:30:00 and requesttime::time < 18:30:00 and requesttime::day in (Mon, Tue, Wed, THu, Fri)', 'CAN stopmachine', 'CAN startmachine' ],
        description: 'This is completely optional'
    }

A policies' `rules` are used for the access control of an account's users'
access.  These rules use [Aperture](https://github.com/joyent/node-aperture) as
the policy language, and are described in detail in the next section.

Our recommendation is to limit each policy's set of rules to a very scoped
collection, and then add one or more of these policies to each group.  This aids
easily reusing existing policies for one or more roles, allowing fine-grained
definition of each role's abilities.


## Rules definition for access control

As mentioned earlier, the policies' rules use
[Aperture Policy Language](https://github.com/joyent/node-aperture#policy-language),
with the following *basic format*:

`<principals> CAN <actions> <resources> WHEN <conditions>`.

You should refer to the
[Aperture documentation](https://github.com/joyent/node-aperture) for the
complete details about the different possibilities when defining new rules.
This section will only cover a limited set strictly related to CloudAPI's usage.

In the case of CloudAPI, `<principal>` will be always the user performing the
HTTP request. Likewise, `<resource>` will always be the URL
of such request, for example `/:account/machines/:machine_id`.

We add one or more roles to a resource to explicitly define the active roles a
user trying to access a given resource must have. Therefore, we don't need to
specify `<principal>` in our rules, given it'll be always defined by the
role-tags of the resource the user is trying to get access to. For the same
reason, we don't need to specify `<resource>` in our rules.

Therefore, CloudAPI's Aperture rules have the format:

        CAN <actions> WHEN <conditions>

By default, the access policy will `DENY` any attempt made by any account
user to access a given resource, unless:

* that resource is tagged with a role
* that role is active
* that role has a policy
* that policy contains a rule which explicity `GRANTS` access to that resource

For example, a user with an active role `read`, which includes a policy rule
like `CAN listmachines and getmachines` will not get access to resources like
`/:account/machines` or `/:account/machines/:machine_id` unless these resources
are *role-tagged* with the role `read` too.

Additionally, given that the `<actions>` included in the policy rule are just
`listmachines` and `getmachine`, the user will be able to retrieve a machine's
details provided by the [GetMachine](#GetMachine) action, but will not be able
to perform any other machine actions (like [StopMachine](#StopMachine)).
However, if the role has a rule including that `<action>` (like StopMachine), or
the user has an additional role which includes that rule, then the user can
invoke that action too.

As an aside, the active roles of a user are set by the `default_members`
attribute in a role. If three different roles contain the "john" user (amongst
others) in their default-members list, then the "john" user will have those
three roles as active roles by default. This can be overridden by passing in
`?as-role=<comma-separated list of role names>` as part of the URL; provided
that each role contains that user in their `members` list, then those roles are
set as the currently-active roles for a request instead.

For more details on how Access Control works for both CloudAPI and Manta,
please refer to [Role Based Access Control][acuguide] documentation.

[acuguide]: https://docs.joyent.com/jpc/rbac/


## Fabrics

A fabric is the basis for building your own private networks that
cannot be accessed by any other user. It represents the physical infrastructure
that makes up a network; however, you don't have to cable or program it. Every
account has its own unique `fabric` in every data center.

On a fabric, you can create your own VLANs and layer three IPv4 networks. You
can create any VLAN from 0-4095, and you can create any number of IPv4 networks
on top of the VLANs, with all of the traditional IPv4 private addresses spaces -
`10.0.0.0/8`, `192.168.0.0/16`, and `172.16.0.0/12` - available for use.

You can create networks on your fabrics to create most network topologies. For
example, you could create a single isolated private network that nothing else
could reach, or you could create a traditional configuration where you have a
database network, a web network, and a load balancer network, each on their own
VLAN.




# An important note about RBAC and certain reads after writes

CloudAPI uses replication and caching behind the scenes for user, role and
policy data. This implies that API reads after a write on these particular
objects can be up to several seconds out of date.

For example, when a user is created, cloudapi returns both a user object
(which is up to date), and a location header indicating where that new user
object actually lives. Following that location header may result in a 404 for
a short period.

As another example, if a policy is updated, the API call will return a policy
object (which is up to date), but GETing that URL again may temporarily return
a outdated object with old object details.

For the time being, please keep in mind that user, role and policy
creation/updates/deletion may potentially take several seconds to settle. They
have eventual consistency, not read-after-write.




# API Introduction

CloudAPI exposes a REST API over HTTPS.  You can work with the REST API by
either calling it directly via tooling you already know about (such as curl, et
al), or by using the CloudAPI SDK from Joyent.  The CloudAPI SDK is available as
an npm module, which you can install with:

    $ npm install smartdc

The rest of this document will show all APIs in terms of both the raw HTTP
specification, the SDK API, and the CLI command.


## Issuing Requests

All HTTP calls to CloudAPI must be made over SSL/TLS, and requests must carry at
least two headers (in addition to standard HTTP headers): `Authorization` and
`Api-Version` header.  The details are explained below.  In addition to these
headers, any requests requiring content must be sent in an acceptable scheme to
CloudAPI.  Details are also below.

### Content-Type

For requests requiring content, you can send parameters encoded with
`application/json`, `application/x-www-form-urlencoded` or
`multipart/form-data`.  Joyent recommends `application/json`.  The value of the
`Accept` header determines the encoding of content returned in responses.
CloudAPI supports `application/json` response encodings only.

For example, all of the following are valid calls:

Query String (on the uri):

    POST /my/keys?name=rsa&key=... HTTP/1.1
    Host: joyent.com
    Authorization: ...
    Content-Length: 0

Form encoded in the body:

    POST /my/keys HTTP/1.1
    Host: joyent.com
    Authorization: ...
    Content-Type: application/x-www-form-urlencoded
    Content-Length: 123

    name=rsa&key=...

JSON in the body:

    POST /my/keys HTTP/1.1
    Host: joyent.com
    Authorization: ...
    Content-Type: application/json
    Content-Length: 123

    {"name":"rsa","key":"..."}

### Authorization

All API calls to CloudAPI require an Authorization header, which supports
multiple ["schemes"](http://tools.ietf.org/html/rfc2617).  Currently CloudAPI
supports only one Authentication mechanism due to PCI compliance restrictions:

* HTTP Signature Authentication Scheme.  This Scheme is outlined in
[Appendix C](#Appendix-C).

In order to leverage HTTP Signature Authentication, only RSA signing mechanisms
are supported, and your keyId must be equal to the path returned from a
[ListKeys](#ListKeys) API call.  For example, if your SmartDataCenter login is
`demo`, and you've uploaded an RSA SSH key with the name `foo`, an Authorization
header would look like:

    Authorization: Signature keyId=/demo/keys/foo,algorithm="rsa-sha256" ${Base64($Date)}

The default value to sign for CloudAPI requests is simply the value of the HTTP
`Date` header.  For more informaton on the Date header value, see
[RFC 2616](http://tools.ietf.org/html/rfc2616#section-14.18).  All requests to
CloudAPI using the Signature authentication scheme *must* send a Date header.
Note that clock skew will be enforced to within 300 seconds (positive or
negative) from the value sent.

Full support for the HTTP Signature Authentication scheme is in the CloudAPI
SDK; an additional reference implementation for Node.js is available in the npm
`http-signature` module, which you can install with:

    npm install http-signature@0.9.11

### Api-Version

CloudAPI is strongly versioned, and all requests *must* specify a version of
the API.  The `Api-Version` header is expected to contain a
[semver](http://semver.org/) string describing the API version the client wants
to use, with the additional twist that your client can specify ranges of
versions it supports, much like you can with npm.  For details on how to specify
ranges, check [node-semver](https://github.com/isaacs/node-semver).  A couple
examples:

    Api-Version: ~7.0
    Api-Version: >=7.0.0

Joyent recommends you set the Api-Version header to `~7.0`; each service
release of SmartDataCenter will increment the `patch` version; any major
releases of SmartDataCenter will increment either the `minor` or `major`
version.

### Using cURL with CloudAPI

Since [cURL](http://curl.haxx.se/) is commonly used to script requests to web
services, here's a simple function you can use to wrap cURL when communicating
with CloudAPI:

    $ function cloudapi() {
      local now=`date -u "+%a, %d %h %Y %H:%M:%S GMT"` ;
      local signature=`echo ${now} | tr -d '\n' | openssl dgst -sha256 -sign ~/.ssh/id_rsa | openssl enc -e -a | tr -d '\n'` ;

      curl -is -H "Accept: application/json" -H "api-version: ~7.0" -H "Date: ${now}" -H "Authorization: Signature keyId=\"/demo/keys/id_rsa\",algorithm=\"rsa-sha256\" ${signature}" --url https://api.example.com$@ ;
      echo "";
    }

With that function, you could just do:

    $ cloudapi /my/machines


## CloudAPI HTTP Responses

Like mentioned above, CloudAPI returns all response objects as
`application/json` encoded HTTP bodies.  In addition to the JSON body, all
responses have the following headers:

||**Header**||**Description**||
||Date||When the response was sent (RFC 1123 format)||
||Api-Version||The exact version of the CloudAPI server you spoke with||
||Request-Id||A unique id for this request; you should log this||
||Response-Time||How long the server took to process your request (ms)||

For backwards compatibility with `~6.5` version of the API, the headers
`X-Api-Version`, `X-Request-Id` and `X-Response-Time` are also provided with
exactly the same values as their counterparts without the `X-` prefix.  These
`X-` prefixed headers will be removed when we remove
[support for version 6.5 of CloudAPI](#appendix-f-sdc-65-support).

If there is content, you can expect:

||**Header**||**Description**||
||Content-Length||How much content, in bytes||
||Content-Type||Formatting of the response (almost always application/json)||
||Content-MD5||An MD5 checksum of the response; you should check this||

### HTTP Status Codes

Your client should check for each of the following status codes from any API
request:

||**Response**||**Code**||**Description**||
||400||Bad Request||Invalid HTTP Request||
||401||Unauthorized||Either no Authorization header was sent, or invalid credentials were used||
||403||Forbidden||No permissions to the specified resource||
||404||Not Found||Something you requested was not found||
||405||Method Not Allowed||Method not supported for the given resource||
||406||Not Acceptable||Try sending a different Accept header||
||409||Conflict||Most likely invalid or missing parameters||
||413||Request Entity Too Large||You sent too much data||
||415||Unsupported Media Type||You encoded your request in a format we don't understand||
||420||Slow Down||You're sending too many requests||
||449||Retry With||Invalid Version header; try with a different Api-Version string||
||503||Service Unavailable||Either there's no capacity in this datacenter, or we're in a maintenance window||

### Error Responses

In the event of an error, CloudAPI will return a standard error response object
in the body with the scheme:

    {
      "code": "CODE",
      "message": "human readable string"
    }

Where the code element is one of:

||**Code**||**Description**||
||BadRequest||You sent bad HTTP||
||InternalError||Something was wrong on our end||
||InUseError||The object is in use and cannot be operated on||
||InvalidArgument||You sent bad arguments or a bad value for an argument||
||InvalidCredentials||Try authenticating correctly||
||InvalidHeader||You sent a bad HTTP header||
||InvalidVersion||You sent a bad Api-Version string||
||MissingParameter||You didn't send a required parameter||
||NotAuthorized||You don't have access to the requested resource||
||RequestThrottled||You were throttled||
||RequestTooLarge||You sent too much request data||
||RequestMoved||HTTP Redirect||
||ResourceNotFound||What you asked for wasn't found||
||UnknownError||Something completely unexpected happened||

Clients are expected to check HTTP status code first, and if it's in the 4xx
range, they can leverage the codes above.




# Account

You can obtain your account details and update them through CloudAPI, with the
notable exception of `login` and `password`. Any password modification should
happen through SDC Portal. `login` cannot be changed at all.


## GetAccount (GET /:login)

Retrieves your account details.

### Inputs

* None

### Returns

Account object:

||**Field**||**Type**||**Description**||
||id||String||Unique id for you||
||login||String||Your login name||
||email||String||Email address||
||companyName||String||...||
||firstName||String||...||
||lastName||String||...||
||address||String||...||
||postalCode||String||...||
||city||String||...||
||state||String||...||
||country||String||...||
||phone||String||...||
||created||Date (ISO8601)||When this account was created||
||updated||Date (ISO8601)||When this account was updated||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If :login does not exist||

### CLI Command

    $ sdc-getaccount

### Example Request

    GET /login HTTP/1.1
    authorization: Signature keyId="..."
    accept: application/json
    accept-version: ~7.0
    host: api.example.com

### Example Response

    HTTP/1.1 200 OK
    content-type: application/json
    content-length: 316
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    connection: Keep-Alive
    content-md5: F7ACwRAC1+7//jajYKbvYw==
    server: Joyent SmartDataCenter 7.0.0
    api-version: 7.0.0
    request-id: 29be67c0-7d0c-11e2-8048-5195b6159808
    response-time: 164
    x-request-id: 29be67c0-7d0c-11e2-8048-5195b6159808
    x-api-version: 7.0.0
    x-response-time: 164

    {
      "id": "cc71f8bb-f310-4746-8e36-afd7c6dd2895",
      "login": "login",
      "email": "login@example.com",
      "companyName": "Example",
      "firstName": "Name",
      "lastName": "Surname",
      "postalCode": "4967",
      "address": [
        "liltingly, Inc.",
        "6165 pyrophyllite Street"
      ],
      "city": "benzoylation concoctive",
      "state": "SP",
      "country": "BAT",
      "phone": "+1 891 657 5818",
      "updated": "2013-12-20T08:58:51.026Z",
      "created": "2013-12-20T08:58:50.721Z"
    }


## UpdateAccount (POST /:login)

Update your account details with the given parameters.

### Inputs

||**Field**||**Type**||**Description**||
||email||String||Email address||
||companyName||String||...||
||firstName||String||...||
||lastName||String||...||
||address||String||...||
||postalCode||String||...||
||city||String||...||
||state||String||...||
||country||String||...||
||phone||String||...||

### Returns

Account object:

||**Field**||**Type**||**Description**||
||id||String||Unique id for you||
||login||String||Your login name||
||email||String||Email address||
||companyName||String||...||
||firstName||String||...||
||lastName||String||...||
||address||String||...||
||postalCode||String||...||
||city||String||...||
||state||String||...||
||country||String||...||
||phone||String||...||
||created||Date (ISO8601)||When this account was created||
||updated||Date (ISO8601)||When this account was updated||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If :login does not exist||

### CLI Command

    $ sdc-updateaccount --postal-code=12345 --phone='1 (234) 567 890'

### Example Request

    POST /login HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    content-type: application/json
    accept-version: ~7.0
    content-length: 48
    content-md5: 6kCHdE651hsI9N82TUkU/g==
    host: api.example.com
    connection: keep-alive

    postal-code=12345&phone=1%20(234)%20567%20890

### Example Response

    HTTP/1.1 200 OK
    content-type: application/json
    content-length: 317
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    connection: Keep-Alive
    content-md5: dRwQeA63/aCqc43sGyyheg==
    server: Joyent SmartDataCenter 7.0.0
    api-version: 7.0.0
    request-id: be62e5b0-7d0f-11e2-918f-912e9d0235c1
    response-time: 326
    x-request-id: be62e5b0-7d0f-11e2-918f-912e9d0235c1
    x-api-version: 7.0.0
    x-response-time: 326

    {
      "id": "cc71f8bb-f310-4746-8e36-afd7c6dd2895",
      "login": "login",
      "email": "login@example.com",
      "companyName": "Example",
      "firstName": "Name",
      "lastName": "Surname",
      "postalCode": "12345",
      "address": [
        "liltingly, Inc.",
        "6165 pyrophyllite Street"
      ],
      "city": "benzoylation concoctive",
      "state": "SP",
      "country": "BAT",
      "phone": "1 (234) 567 890",
      "updated": "2013-12-20T08:58:51.026Z",
      "created": "2013-12-20T08:58:50.721Z"
    }




# Keys

This part of the API is the means by which you operate on your SSH/signing keys.
These keys are needed in order to login to machines over SSH, as well as signing
requests to this API (see the HTTP Signature Authentication Scheme outlined in
[Appendix C](#Appendix-C) for more details).

Currently CloudAPI supports uploads of public keys in the OpenSSH format.

Note that while it's possible to provide a `name` attribute for an SSH key, in
order to use it as an human-friendly alias, this attribute's presence is
completely optional.  When it's not provided, the ssh key fingerprint will be
used as the `name` instead.

On the following routes, the parameter placeholder `:key` can be replaced with
with either the key's `name` or its `fingerprint`.  It's strongly recommended to
use `fingerprint` when possible, since the `name` attribute does not have
uniqueness constraints.


## ListKeys (GET /:login/keys)

Lists all public keys we have on record for the specified account.

### Inputs

* None

### Returns

An array of key objects.  Keys are:

||**Field**||**Type**||**Description**||
||name||String||Name for this key||
||fingerprint||String||Key fingerprint||
||key||String||Public key in OpenSSH format||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` does not exist||

### CLI Command

    $ sdc-listkeys

### Example Request

    GET /my/keys HTTP/1.1
    Host: api.example.com
    Authorization: ...
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 OK
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Server: SmartDataCenter
    Connection: close
    Date: Tue, 28 Jun 2011 23:05:42 GMT
    X-API-Version: 7.0.0
    X-RequestId: 9E962AAA-E5F6-487F-8339-45FABA3CF5BD
    X-Response-Time: 66
    Content-Type: application/json
    Content-Length: 503
    Content-MD5: RHiVkkX0AZHOjijYqJFRNg==

    [
      {
        "name": "rsa",
        "key": "ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEA0A5Pf5Cq...",
        "fingerprint": "59:a4:..."
      }
    ]


## GetKey (GET /:login/keys/:key)

Retrieves the record for an individual key.

### Inputs

* None

### Returns

||**Field**||**Type**||**Description**||
||name||String||Name for this key||
||fingerprint||String||Key fingerprint||
||key||String||OpenSSH formatted public key||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:key` does not exist||

### CLI Command

    $ sdc-getkey rsa

### Example Request

    GET /my/keys/rsa HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 OK
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, DELETE
    Server: SmartDataCenter
    Connection: close
    Date: Tue, 28 Jun 2011 23:14:34 GMT
    X-Api-Version: 7.0.0
    X-RequestId: BE3559EE-713B-43EB-8DEB-6EE93F441C23
    X-Response-Time: 78
    Content-Type: application/json
    Content-Length: 501
    Content-MD5: O5KO1sbXxLHk1KHxN6U+Fw==

    {
      "name": "rsa",
      "key": "ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEA0A5Pf5Cq...",
      "fingerprint": "59:a4:61:..."
    }


## CreateKey (POST /:login/keys)

Uploads a new OpenSSH key to SmartDataCenter for use in HTTP signing and SSH.

### Inputs

||**Field**||**Type**||**Description**||
||name||String||Name for this key (optional)||
||key||String||OpenSSH formatted public key||

### Returns

||**Field**||**Type**||**Description**||
||name||String||Name for this key||
||fingerprint||String||Key fingerprint||
||key||String||OpenSSH formatted public key||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||InvalidArgument||If name or key is invalid (usually key)||
||MissingParameter||If you didn't send a key||
||ResourceNotFound||If `:login` does not exist||

### CLI Command

    $ sdc-createkey -n id_rsa ~/.ssh/id_rsa.pub

### Example Request

    POST /my/keys HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 455
    Content-Type: application/json
    Api-Version: ~7.0

    {
      "name": "id_rsa",
      "key": "ssh-rsa AAA...",
      "fingerprint": "59:a4:..."
    }

### Example Response

    HTTP/1.1 201 Created
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Server: SmartDataCenter
    Connection: close
    Date: Tue, 28 Jun 2011 23:14:34 GMT
    X-Api-Version: 7.0.0
    X-RequestId: BE3559EE-713B-43EB-8DEB-6EE93F441C23
    X-Response-Time: 78
    Content-Type: application/json
    Content-Length: 501
    Content-MD5: O5KO1sbXxLHk1KHxN6U+Fw==

    {
      "name": "rsa",
      "key": "ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEA0A5Pf5Cq...",
      "fingerprint": "59:a4:..."
    }


## DeleteKey (DELETE /:login/keys/:key)

Deletes a single SSH key, by name or fingerprint.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:key` does not exist||

### CLI Command

    $ sdc-deletekey id_rsa

#### Example Request

    DELETE /my/keys/id_rsa HTTP/1.1
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0
    Content-Length: 0

#### Example Response

    HTTP/1.1 204 No Content
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, DELETE
    Server: SmartDataCenter
    Connection: close
    Date: Tue, 28 Jun 2011 23:14:34 GMT
    X-Api-Version: 7.0.0
    X-RequestId: 4655EA0A-C4CB-4486-8AA9-8C8C9A0B71B1
    X-Response-Time: 65
    Content-Length: 0




# Users

## ListUsers (GET /:account/users)

Returns a list of account user objects.  These have the same format as the main
[account](#account) object.

### Inputs

* None

### Returns

Array of user objects.  Each user object has the following fields:

||**Field**||**Type**||**Description**||
||id||String||Unique id for the user||
||login||String||Sub-user login name||
||email||String||Email address||
||companyName||String||...||
||firstName||String||...||
||lastName||String||...||
||address||String||...||
||postalCode||String||...||
||city||String||...||
||state||String||...||
||country||String||...||
||phone||String||...||
||created||Date (ISO8601)||When this user was created||
||updated||Date (ISO8601)||When this user was updated||

### Errors

||**Error Code**||**Description**||
||ResourceNotFound||If `:account` does not exist||


### CLI Command:

    $ sdc-user list


### Example Request

    GET /my/users HTTP/1.1
    Accept: application/json
    Host: api.example.com
    Api-Version: ~7.2
    Authorization: Signature keyId...

### Example Response

    HTTP/1.1 200 Ok
    Location: /my/users
    Content-Type: application/json
    Content-Length: 400
    Server: Joyent SmartDataCenter 7.2.0
    Api-Version: 7.2.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    [{
        id: 'ed976ee5-80a4-42cd-b0d6-5493b7d41132',
        login: 'a4ce91ff',
        email: 'a4ce91ff_test@test.com',
        updated: '2014-02-13T09:18:46.644Z',
        created: '2014-02-13T09:18:46.644Z'
    }, {
        id: '27829465-4150-4fad-9c01-08e0a52267fb',
        login: 'a0af26cf',
        email: 'a0af26cf_test@test.com',
        updated: '2014-02-13T09:20:08.334Z',
        created: '2014-02-13T09:20:08.334Z'
    }]


## GetUser (GET /:account/users/:user)

Get an account user.

### Inputs

||**Field**||**Type**||**Description**||
||membership||Boolean||When given, the user roles will also be returned||

### Returns

An array of user objects.  Each user object has the following fields:

||**Field**||**Type**||**Description**||
||id||String||Unique id for the user||
||login||String||Sub-user login name||
||email||String||Email address||
||companyName||String||...||
||firstName||String||...||
||lastName||String||...||
||address||String||...||
||postalCode||String||...||
||city||String||...||
||state||String||...||
||country||String||...||
||phone||String||...||
||created||Date (ISO8601)||When this user was created||
||updated||Date (ISO8601)||When this user was updated||
||roles||Array||User role names (only when `membership` option is present in request)||
||default_roles||Array||User active role names (only when `membership` option is present in request)||

### Errors

||**Error Code**||**Description**||
||ResourceNotFound||When `:account` or `:user` do not exist||

### CLI Command:

    $ sdc-user get ed976ee5-80a4-42cd-b0d6-5493b7d41132


### Example Request

    GET /my/users/ed976ee5-80a4-42cd-b0d6-5493b7d41132?membership=true HTTP/1.1
    Accept: application/json
    Host: api.example.com
    Api-Version: ~7.2
    Authorization: Signature keyId...

### Example Response

    HTTP/1.1 200 Ok
    Content-Type: application/json
    Content-Length: 199
    Server: Joyent SmartDataCenter 7.2.0
    Api-Version: 7.2.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    {
        id: 'ed976ee5-80a4-42cd-b0d6-5493b7d41132',
        login: 'a4ce91ff',
        email: 'a4ce91ff_test@test.com',
        roles: ['devs', 'admins'],
        default_roles: ['devs'],
        updated: '2014-02-13T09:18:46.644Z',
        created: '2014-02-13T09:18:46.644Z'
    }


## CreateUser (POST /:account/users)

Creates a new user under an account.

### Inputs

||**Field**||**Type**||**Description**||
||email||String||(Required) Email address||
||login||String||(Required) Login||
||password||String||(Required) Password||
||companyName||String||...||
||firstName||String||...||
||lastName||String||...||
||address||String||...||
||postalCode||String||...||
||city||String||...||
||state||String||...||
||country||String||...||
||phone||String||...||

### Returns

User object:

||**Field**||**Type**||**Description**||
||id||String||Unique id for the user||
||login||String||Sub-user `login` name||
||email||String||Email address||
||companyName||String||...||
||firstName||String||...||
||lastName||String||...||
||address||String||...||
||postalCode||String||...||
||city||String||...||
||state||String||...||
||country||String||...||
||phone||String||...||
||created||Date (ISO8601)||When this user was created||
||updated||Date (ISO8601)||When this user was updated||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||InvalidArgument||If any of the parameters are invalid, e.g. you try to add a login name already taken by another user of your account||
||MissingParameter||If you didn't send a `login`, `email` or `password`||
||ResourceNotFound||If `:account` does not exist||

### CLI Command:

    $ sdc-user create --login=bob --email=bob@test.joyent.com --password=123secret


### Request:

    POST /my/users HTTP/1.1
    Host: 0.0.0.0:8080
    accept: application/json
    content-type: application/json
    user-agent: restify/2.6.1 (x64-darwin; v8/3.14.5.9; OpenSSL/1.0.1e) node/0.10.26
    accept-version: *
    date: Thu, 01 May 2014 15:35:21 GMT
    content-length: 79
    content-md5: E9EmDJjKXMfIsi2mKbwoZA==

    {
      "login": "pedro",
      "email": "pedro_test@joyent.com",
      "password": "s3cr3t"
    }

### Response:

    HTTP/1.1 201 Created
    location: /thejoy.test@joyent.com/users/1e8369ff-d701-4468-8bfe-950a6ea2432e
    content-type: application/json
    content-length: 173
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: POST, GET, HEAD
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    connection: Keep-Alive
    content-md5: 2laf0bFOI8tw9uxMmzPbPw==
    date: Thu, 01 May 2014 15:35:21 GMT
    server: Joyent SmartDataCenter 7.1.1
    api-version: 7.2.0
    request-id: 34d05030-d146-11e3-a115-31daadd0e9a3
    response-time: 155
    x-request-id: 34d05030-d146-11e3-a115-31daadd0e9a3
    x-api-version: 7.2.0
    x-response-time: 155

    {
      "id": "1e8369ff-d701-4468-8bfe-950a6ea2432e",
      "login": "pedro",
      "email": "pedro_test@joyent.com",
      "updated": "2014-05-01T15:35:21.638Z",
      "created": "2014-05-01T15:35:21.638Z"
    }



## UpdateUser (POST /:account/users/:user)

Update any user's modifiable properties.

Password changes are not allowed using this route; there is an additional route
for password changes so it can be selectively allowed/disallowed for users
using policies.

### Inputs

||**Field**||**Type**||**Description**||
||email||String||(Required) Email address||
||companyName||String||...||
||firstName||String||...||
||lastName||String||...||
||address||String||...||
||postalCode||String||...||
||city||String||...||
||state||String||...||
||country||String||...||
||phone||String||...||

### Returns

User object:

||**Field**||**Type**||**Description**||
||id||String||Unique id for the user||
||login||String||Sub-user login name||
||email||String||Email address||
||companyName||String||...||
||firstName||String||...||
||lastName||String||...||
||address||String||...||
||postalCode||String||...||
||city||String||...||
||state||String||...||
||country||String||...||
||phone||String||...||
||created||Date (ISO8601)||When this user was created||
||updated||Date (ISO8601)||When this user was updated||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||InvalidArgument||If any of the parameters are invalid, e.g. you try to add a `login` name already taken by another user of your account||
||MissingParameter||If you didn't send a `login` or `email`||
||ResourceNotFound||If `:account` or `:user` do not exist||

### CLI Command:

    $ sdc-user update 93c3d419-a927-6195-b6fc-b3a4af541aa3 --login=joe

## ChangeUserPassword (POST /:account/users/:user/change_password)

This is a separate rule for password change, so different policies can be used
for an user trying to modify other data, or only their own password.

### Inputs

||**Field**||**Type**||**Description**||
||password||String||(Required) Password||
||password\_confirmation||String||(Required) Password confirmation||

### Returns

User object:

||**Field**||**Type**||**Description**||
||id||String||Unique id for the user||
||login||String||Sub-user login name||
||email||String||Email address||
||companyName||String||...||
||firstName||String||...||
||lastName||String||...||
||address||String||...||
||postalCode||String||...||
||city||String||...||
||state||String||...||
||country||String||...||
||phone||String||...||
||created||Date (ISO8601)||When this user was created||
||updated||Date (ISO8601)||When this user was updated||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||InvalidArgument||The provided `password` and `password\_confirmation` didn't match||
||MissingParameter||Either `password` or `password\_confirmation` parameters are missing||
||ResourceNotFound||If `:account` or `:user` do not exist||

### CLI Command:

    $ sdc-user change-password 93c3d419-a927-6195-b6fc-b3a4af541aa3 --password=foo123bar --password-confirmation=foo123bar

### Example Request

    POST /my/users/ed976ee5-80a4-42cd-b0d6-5493b7d41132/change_password HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.2
    Content-Length: 40
    Authorization: Signature keyId...

    {
        "password": "foo123bar",
        "password_confirmation": "foo123bar"
    }

### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Content-Length: 199
    Api-Version: 7.2.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    {
        id: 'ed976ee5-80a4-42cd-b0d6-5493b7d41132',
        login: 'a4ce91ff',
        email: 'a4ce91ff_test@test.com',
        updated: '2014-02-13T09:18:46.644Z',
        created: '2014-02-13T09:18:46.644Z'
    }


## DeleteUser (DELETE /:account/users/:user)

Remove a user. They will no longer be able to use this API.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:account` does not exist or there isn't a user with either the `login` or `id` given as `:user` value||

### CLI Command:

    $ sdc-user delete 707811cd-d0fa-c5cc-f41f-bfd2d9f545d1

#### Example Request

    DELETE /my/users/ed976ee5-80a4-42cd-b0d6-5493b7d41132 HTTP/1.1
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.2
    Content-Length: 0

#### Example Response

    HTTP/1.1 204 No Content
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, DELETE
    Server: SmartDataCenter
    Connection: close
    Date: Tue, 28 Jun 2011 23:14:34 GMT
    Api-Version: 7.2.0
    RequestId: 4655EA0A-C4CB-4486-8AA9-8C8C9A0B71B1
    Response-Time: 65
    Content-Length: 0




# Roles

## ListRoles (GET /:account/roles)

Returns an array of account roles.

### Inputs

* None

### Returns

||**Field**||**Type**||**Description**||
||name||String||The role name||
||members||Array||The list of this account's user logins this role applies to (Optional)||
||default_members||Array||The list of this account's user logins this role applies to by default (Optional)||
||policies||Array||The list of this account's policies which this role obeys (Optional)||
||id||String||(UUID) Unique role identifier||

### Errors

||**Error Code**||**Description**||
||ResourceNotFound||If `:account` does not exist||


### CLI Command:

    $ sdc-role list

### Example Request

    GET /my/roles HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.2
    Authorization: Signature keyId...

### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Content-Length: 99
    Server: Joyent SmartDataCenter 7.2.0
    Api-Version: 7.2.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    [{
        "id": "4025de02-b4b6-4041-ae72-0749e99a5ac4",
        "name": "reboot",
        "members": ["bob","fred","pedro"],
        "default_members": ["bob","fred"],
        "policies": ["rebootMachine"]
    }]


## GetRole (GET /:account/roles/:role)

Get an account role (`:role`) by `id`.

### Inputs

* None

### Returns

||**Field**||**Type**||**Description**||
||name||String||The role name||
||members||Array||The list of this account's user logins this role applies to (Optional)||
||default_members||Array||The list of this account's user logins this role applies to by default (Optional)||
||policies||Array||The list of this account's policies which this role obeys (Optional)||
||id||String||(UUID) Unique role identifier||

### Errors

||**Error Code**||**Description**||
||ResourceNotFound||If `:account` or `:role` do not exist||


### CLI Command:

    $ sdc-role get 4025de02-b4b6-4041-ae72-0749e99a5ac4

### Example Request

    GET /my/roles/4025de02-b4b6-4041-ae72-0749e99a5ac4 HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.2
    Authorization: Signature keyId...

### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Content-Length: 97
    Server: Joyent SmartDataCenter 7.2.0
    Api-Version: 7.2.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    {
        "id": "4025de02-b4b6-4041-ae72-0749e99a5ac4",
        "name": "reboot",
        "members": ["bob","fred","pedro"],
        "policies": ["rebootMachine"]
    }


## CreateRole (POST /:account/roles)

Create a new role for your account.

### Inputs

||**Field**||**Type**||**Description**||
||name||String||The role name||
||members||Array||The list of account's user logins to be added to this role (Optional)||
||default_members||Array||The list of account's user logins to be added to this role and have it enabled by default (Optional)||
||policies||Array||The list of account's policies to be given to this role (Optional)||

### Returns

Account role.

||**Field**||**Type**||**Description**||
||name||String||The role name||
||members||Array||The list of this account's user logins this role applies to (Optional)||
||default_members||Array||The list of this account's user logins this role applies to by default (Optional)||
||policies||Array||The list of this account's policies which this role obeys (Optional)||
||id||String||(UUID) Unique role identifier||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||InvalidArgument||If member or policies are invalid, e.g. you try to add a non-existent user||
||MissingParameter||If you didn't send a `name`||
||ResourceNotFound||If `:account` does not exist||

### CLI Command:

    $ sdc-role create --name='test-role' --members=bob --members=fred --default-members=bob --policies=test-policy

Possible alternate formats to pass in multiple items; in `sdc-role`, CSV and
JSON are also acceptable formats for `--members`, `--default-members` and
`--policies`:

    $ sdc-role create --name='test-role' --members=bob,fred --default-members=bob --policies=test-policy
    $ sdc-role create --name='test-role' --members='["bob","fred"]' --default-members=bob --policies=test-policy


### Example Request

    POST /my/roles HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.2
    Content-Length: 40
    Authorization: Signature keyId...

    {
        "name": "reboot",
        "members": ["bob","fred","pedro"],
        "policies": ["rebootMachine"]
    }

### Example Response

    HTTP/1.1 201 Created
    Location: /my/roles/4025de02-b4b6-4041-ae72-0749e99a5ac4
    Content-Type: application/json
    Content-Length: 97
    Server: Joyent SmartDataCenter 7.2.0
    Api-Version: 7.2.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    {
        "id": "4025de02-b4b6-4041-ae72-0749e99a5ac4",
        "name": "reboot",
        "members": ["bob","fred","pedro"],
        "policies": ["rebootMachine"]
    }


## UpdateRole (POST /:account/roles/:role)

Modifies an account role.  Anything but `id` can be modified.

### Inputs

||**Field**||**Type**||**Description**||
||name||String||The role name (Required)||
||members||Array||The list of account's user logins to be added to this role (Optional)||
||default_members||Array||The list of account's user logins to be added to this role and have it enabled by default (Optional)||
||policies||Array||The list of account's policies to be given to this role (Optional)||

### Returns

Account role

||**Field**||**Type**||**Description**||
||name||String||The role name||
||members||Array||The list of account's user logins to be added to this role (Optional)||
||default_members||Array||The list of account's user logins to be added to this role and have it enabled by default (Optional)||
||policies||Array||The list of account's policies to be given to this role (Optional)||
||id||String||(UUID) Unique role identifier. Identifier purpose is just to allow role name modifications||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||InvalidArgument||If member or policies are invalid, e.g. you tried to add an non-existent user||
||MissingParameter||If you didn't send a `name`||
||ResourceNotFound||If `:account` does not exist||

### CLI Command:

    $ sdc-role update 3c2ef9da-b137-6a87-f227-dad1db4219b7 --members=joe,bob --default-members=bob,joe

### Example Request

    POST /my/roles/4025de02-b4b6-4041-ae72-0749e99a5ac4 HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.2
    Content-Length: 40
    Authorization: Signature keyId...

    {
        "policies": ["rebootMachine", "resizeMachine"]
    }

### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Content-Length: 97
    Server: Joyent SmartDataCenter 7.2.0
    Api-Version: 7.2.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    {
        "id": "4025de02-b4b6-4041-ae72-0749e99a5ac4",
        "name": "reboot",
        "members": ["bob","fred","pedro"],
        "policies": ["rebootMachine", "resizeMachine"]
    }


## DeleteRole (DELETE /:account/roles/:role)

Remove a role.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:account` or `:role` do not exist||

### CLI Command:

    $ sdc-role delete 4025de02-b4b6-4041-ae72-0749e99a5ac4

#### Example Request

    DELETE /my/roles/4025de02-b4b6-4041-ae72-0749e99a5ac4 HTTP/1.1
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.2
    Content-Length: 0

#### Example Response

    HTTP/1.1 204 No Content
    Connection: close
    Date: Tue, 28 Jun 2011 23:14:34 GMT
    Api-Version: 7.2.0
    RequestId: 4655EA0A-C4CB-4486-8AA9-8C8C9A0B71B1
    Response-Time: 65
    Content-Length: 0




# Role Tags

## SetRoleTags (PUT /:resource_path)

Sets the given role tags to the provided resource path. `resource_path`
can be the path to any of the CloudAPI resources described into this document:
account, keys, users, roles, policies, user's ssh keys, datacenters, images,
packages, machines, analytics, instrumentations, firewall rules and networks.

For each of these you can set role tags either for an individual resource or
for the whole group; i.e., you can set role tags for all the machines using:

        PUT /:account/machines

or just for a given machine using

        PUT /:account/machines/:machine_id

### Inputs

||**Field**||**Type**||**Description**||
||role-tag||Array||The list role-tags to be added to this resource||

### Returns

Resource role tags

||**Field**||**Type**||**Description**||
||name||String||Path to the resource||
||role-tag||Array||The list of role tags assigned to this resource||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||InvalidArgument||The provided resource path is not valid||
||ResourceNotFound||If :resource_path does not exist||


### CLI Command:

    $ sdc-chmod -- =read,create /my/machines

The list of role-tags assigned to a given resource can be obtained from the
command line with `sdc-info /:resource_path`:

    $ sdc-info /my/machines

### Example Request

    PUT /my/machines HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.2
    content-length: 26
    content-md5: KwJKP+w/roeR+pRgKTMo7w==
    Authorization: Signature keyId...

    {
        "role-tag": ["test-role"]
    }

### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Content-Length: 97
    Server: Joyent SmartDataCenter 7.2.0
    Api-Version: 7.2.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    {
        "name": "/my/machines",
        "role-tag": [
          "test-role"
        ]
    }



# Policies

## ListPolicies (GET /:account/policies)

Retrieves a list of account policies.

### Inputs

* None

### Returns

||**Field**||**Type**||**Description**||
||name||String||The policy name||
||rules||Array||One or more Aperture sentences applying to the policy||
||description||String||A description for this policy||
||id||String||(UUID) Unique policy identifier||

### Errors

||**Error Code**||**Description**||
||ResourceNotFound||If `:account` does not exist||


### CLI Command:

    $ sdc-policy list

### Example Request

    GET /my/policies HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.2
    Authorization: Signature keyId...

### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Content-Length: 97
    Server: Joyent SmartDataCenter 7.2.0
    Api-Version: 7.2.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    [{
        "id": "4025de02-b4b6-4041-ae72-0749e99a5ac4",
        "name": "rebootMachine",
        "rules": ["* can rebootMachine *"],
        "description": "Restart any machine"
    }]


## GetPolicy (GET /:account/policies/:policy)

Get an account policy (`:policy`) by `id`.

### Inputs

* None

### Returns

||**Field**||**Type**||**Description**||
||name||String||The policy name||
||rules||Array||One or more Aperture sentences applying to the policy||
||description||String||A description for this policy||
||id||String||(UUID) Unique policy identifier||

### Errors

||**Error Code**||**Description**||
||ResourceNotFound||If `:account` or `:role` do not exist||


### CLI Command:

    $ sdc-policy get 1e14dd3e-dc9d-6cd6-dd5a-ab5a159e96d7

### Example Request

    GET /my/policies/4025de02-b4b6-4041-ae72-0749e99a5ac4 HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.2
    Authorization: Signature keyId...

### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Content-Length: 97
    Server: Joyent SmartDataCenter 7.2.0
    Api-Version: 7.2.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    {
        "id": "4025de02-b4b6-4041-ae72-0749e99a5ac4",
        "name": "rebootMachine",
        "rules": ["* can rebootMachine *"],
        "description": "Restart any machine"
    }


## CreatePolicy (POST /:account/policies)

Creates a new account policy.

### Inputs

||**Field**||**Type**||**Description**||
||name||String||The policy name||
||rules||Array||One or more Aperture sentences to be added to the current policy||
||description||String||A description for this policy (Optional)||

### Returns

||**Field**||**Type**||**Description**||
||name||String||The policy name||
||rules||Array||One or more Aperture sentences applying to the policy||
||description||String||A description for this policy||
||id||String||(UUID) Unique policy identifier||

### Errors

||**Error Code**||**Description**||
||ResourceNotFound||If `:account` or `:role` do not exist||


### CLI Command:

    $ sdc-policy create --name=test-policy --description='Policy to test cmdln tool' --rules='CAN rebootmachine, createmachine AND getmachine' --rules='CAN listkeys AND listuserkeys'

### Example Request

    POST /my/policies HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.2
    Authorization: Signature keyId...


    {
        "name": "rebootMachine",
        "rules": ["* can rebootMachine *"],
        "description": "Restart any machine"
    }

### Example Response

    HTTP/1.1 201 Created
    Content-Type: application/json
    Content-Length: 97
    Server: Joyent SmartDataCenter 7.2.0
    Api-Version: 7.2.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    {
        "id": "4025de02-b4b6-4041-ae72-0749e99a5ac4",
        "name": "rebootMachine",
        "rules": ["* can rebootMachine *"],
        "description": "Restart any machine"
    }


## UpdatePolicy (POST /:account/policies/:policy)

Upgrades an existing account policy.  Everything but id can be modified.

### Inputs

||**Field**||**Type**||**Description**||
||name||String||The policy name||
||rules||Array||One or more Aperture sentences to replace in the current policy||
||description||String||A description for this policy||

### Returns

||**Field**||**Type**||**Description**||
||name||String||The policy name||
||rules||Array||One or more Aperture sentences applying to the policy||
||description||String||A description for this policy||
||id||String||(UUID) Unique policy identifier||

### Errors

||**Error Code**||**Description**||
||ResourceNotFound||If `:account` or `:role` do not exist||


### CLI Command:

    $ sdc-policy update 1e14dd3e-dc9d-6cd6-dd5a-ab5a159e96d7 --rules='CAN rebootmachine, createmachine AND getmachine' --rules='CAN listkeys AND listuserkeys' --rules='CAN stopmachine, startmachine, renamemachine, enablemachinefirewall AND disablemachinefirewall'

### Example Request

    POST /my/policies/4025de02-b4b6-4041-ae72-0749e99a5ac4 HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.2
    Authorization: Signature keyId...


    {
        "description": "Restart whatever machine, no matter from which IP address"
    }

### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Content-Length: 97
    Server: Joyent SmartDataCenter 7.2.0
    Api-Version: 7.2.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    {
        "id": "4025de02-b4b6-4041-ae72-0749e99a5ac4",
        "name": "rebootMachine",
        "rules": ["* can rebootMachine *"],
        "description": "Restart whatever machine, no matter from which IP address"
    }


## DeletePolicy (DELETE /:account/policies/:policy)

Deletes an existing policy.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:account` or `:policy` do not exist||

### CLI Command:

    $ sdc-policy delete 1e14dd3e-dc9d-6cd6-dd5a-ab5a159e96d7

#### Example Request

    DELETE /my/policies/4025de02-b4b6-4041-ae72-0749e99a5ac4 HTTP/1.1
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.2
    Content-Length: 0

#### Example Response

    HTTP/1.1 204 No Content
    Connection: close
    Date: Tue, 28 Jun 2011 23:14:34 GMT
    Api-Version: 7.2.0
    RequestId: 4655EA0A-C4CB-4486-8AA9-8C8C9A0B71B1
    Response-Time: 65
    Content-Length: 0




# User SSH Keys

See account [keys](#keys) for a detailed description.  Only difference is the
path from where you can access users' keys:

## ListUserKeys (GET /:account/users/:user/keys)

Lists all public keys we have on record for the specified account user.
See [ListKeys](#ListKeys).

### CLI Command:

    $ sdc-user keys dd71f8bb-f310-4746-8e36-afd7c6dd2895

## GetUserKey (GET /:account/users/:user/keys/:key)

Retrieves the given key record either by fingerprint or name.
See [GetKey](#GetKey).

### CLI Command:

    $ sdc-user key dd71f8bb-f310-4746-8e36-afd7c6dd2895 '0b:56:ae:c5:d1:7b:7a:98:09:58:1a:a2:0c:22:63:9f'


## CreateUserKey (POST /:account/users/:user/keys)

Creates a new key record.  See [CreateKey](#CreateKey).

### CLI Command:

    $ sdc-user upload-key -n test 93c3d419-a927-6195-b6fc-b3a4af541aa3 ~/.ssh/id_rsa.pub

## DeleteUserKey (DELETE /:account/users/:user/keys/:key)

Removes a key.  See [GetKey](#GetKey).

### CLI Command:

    $ sdc-user delete-key dd71f8bb-f310-4746-8e36-afd7c6dd2895 '0b:56:ae:c5:d1:7b:7a:98:09:58:1a:a2:0c:22:63:9f'



# Config

These endpoints allow you to get and set configuration values related to your
account.

## GetConfig (GET /:login/config)

Outputs configuration for your account.  The configuration values that are
currently configurable are:

* `default_network`: the network that docker containers are provisioned on.


### Inputs

* None

### Returns

An object with configuration values.

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

### CLI Command

A user's default fabric network is stored on this config object. The following
command uses this endpoint to retrieve it.

    $ sdc-fabric network get-default
    7fa999c8-0d2c-453e-989c-e897716d0831

### Example Request

    GET /my/config HTTP/1.1
    Authorization: Basic ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.3

### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Content-Length: 60
    Server: Joyent SmartDataCenter 7.3.0
    Api-Version: 7.3.0


    {
      "default_network": "7fa999c8-0d2c-453e-989c-e897716d0831"
    }

## UpdateConfig (PUT /:login/config)

Updates configuration values for your account.

### Inputs

||**Field**||**Type**||**Description**||
||default_network||String||ID of the network used for provisioning docker containers||

### Returns

An object with the updated configuration.

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

### CLI Command

    $ sdc-fabric network set-default c786128e-fa80-11e4-bdad-83592a0bd906

### Example Request

    PUT /my/config HTTP/1.1
    Authorization: Basic ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.3
    {
        "default_network": "c786128e-fa80-11e4-bdad-83592a0bd906"
    }

### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Content-Length: 60
    Server: Joyent SmartDataCenter 7.3.0
    Api-Version: 7.3.0

    {
        "default_network": "c786128e-fa80-11e4-bdad-83592a0bd906"
    }




# Datacenters

## ListDatacenters (GET /:login/datacenters)

Provides a list of all datacenters this cloud is aware of.

### Inputs

* None

### Returns

An object where the keys are the datacenter name, and the value is the URL
endpoint of that datacenter's Cloud API.

||**Field**||**Type**||**Description**||
||$datacentername||URL||location of the datacenter||


### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` does not exist||

### CLI Command

    $ sdc-listdatacenters

#### Example Request

    GET /my/datacenters HTTP/1.1
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0
    Content-Length: 0

#### Example Response

    HTTP/1.1 200 OK
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET
    Connection: close
    x-api-version: 7.0.0
    Date: Mon, 06 Jun 2011 18:45:21 GMT
    Server: SmartDataCenter
    x-request-id: 75812321-5887-45ae-b0d4-6e562cb463b5
    x-response-time: 0
    Content-Type: application/json
    Content-Length: 28
    Content-MD5: nvk5mzwiEmQEfWbQCcBauQ==

    {
      "us-west-1": "https://us-west-1.api.joyentcloud.com"
    }


## GetDatacenter (GET /:login/datacenters/:name)

Gets an individual datacenter by name.  Returns an HTTP redirect to your
client, where the datacenter url is in the Location header.

### Inputs

* None

### Returns

An object formatted like an Error Response; check the `Location` header for the
URL itself.

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` does not exist or `:name` does not exist||

### CLI Command

* None

### Example Request

    GET /my/datacenters/joyent HTTP/1.1
    Authorization: Basic ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 302 Moved Temporarily
    Location: https://api.example.com
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET
    Connection: close
    x-api-version: 7.0.0
    Date: Mon, 06 Jun 2011 18:47:01 GMT
    Server: SmartDataCenter
    x-request-id: e7b35c46-c36d-4e02-8cde-6fdf2695af15
    x-response-time: 178
    Content-Type: application/json
    Content-Length: 875
    Content-MD5: FV3cglJSamXOETia0jOZ5g==


    {
      "code": "ResourceMoved",
      "message": joyent is at https://api.example.com"
    }



# Services

## ListServices (GET /:login/services)

Provides the URL endpoints for services for this datacenter. It is a mapping
of service name to URL endpoint.

### Inputs

* None

### Returns

An object where the keys are the service name, and the value is the URL
endpoint.

||**Field**||**Type**||**Description**||
||$serviceName||URL||URL endpoint of that service||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` does not exist||


#### Example Request

    GET /my/services HTTP/1.1
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0
    Content-Length: 0

#### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Content-Length: 26
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Headers: Accept, Accept-Version, ...
    Access-Control-Allow-Methods: GET
    Access-Control-Expose-Headers: Api-Version, Request-Id, Response-Time
    Connection: Keep-Alive
    Content-MD5: xeiJhwRr1nPZp1bDheSJZg==
    Date: Fri, 27 Feb 2015 05:09:49 GMT
    Server: Joyent SmartDataCenter 7.2.0
    Api-Version: 7.2.0
    Request-Id: da9eaf80-be3e-11e4-8b3c-078d3dc40603
    Response-Time: 100
    X-Request-Id: da9eaf80-be3e-11e4-8b3c-078d3dc40603
    X-Api-Version: 7.2.0
    X-Response-Time: 100

    {
      "cloudapi": "https://us-west-1.api.example.com",
      "docker": "tcp://us-west-1.docker.example.com",
      "manta": "https://us-west.manta.example.com"
    }


# Images

An [image](#image-description) contains the software packages that will be
available on newly provisioned machines.  In the case of virtual machines, the
dataset also includes the operating system.

## ListImages (GET /:login/images)

Provides a list of images available in this datacenter.

### Inputs

The following optional query parameters are available to filter the list of
images:

||**Field**||**Type**||**Description**||
||name||String||The "friendly" name for this image||
||os||String||The underlying operating system for this image||
||version||String||The version for this image||
||public||Boolean||(New in 7.1.) Filter public/private images, e.g. `?public=true`, `?public=false`||
||state||String||(New in 7.1.) Filter on image [state](https://images.joyent.com/docs/#manifest-state). By default only active images are shown. Use `?state=all` to list all images.||
||owner||String||(New in 7.1.) Filter on the owner UUID.||
||type||String||(New in 7.1.) Filter on the image type, e.g. `?type=smartmachine`.||

### Returns

An array of images.  Image objects include the following fields:

|| **Field**    ||**Type**||**Description**||
|| id           || String ||A unique identifier for this image||
|| name         || String ||The "friendly" name for this image||
|| os           || String ||The underlying operating system for this image||
|| version      || String ||The version for this image||
|| type         || String ||Whether this is a smartmachine or virtualmachine dataset||
|| requirements || Object ||Contains a grouping of various minimum requirements for provisioning a machine with this image. For example 'password' indicates that a password must be provided.||
|| homepage     || String ||(New in 7.0.) The URL for a web page with more detailed information for this image||
|| files        || Array  ||(New in 7.1.) An array of image files that make up each image. Currently only a single file per image is supported.||
|| files[0].compression     || String ||(New in 7.1.) The type of file compression used for the image file. One of 'bzip2', 'gzip', 'none'.||
|| files[0].sha1     || String ||(New in 7.1.) SHA-1 hex digest of the file content. Used for corruption checking.||
|| files[0].size     || Number ||(New in 7.1.) File size in bytes.||
|| published_at || String (ISO-8859) ||(New in 7.0.) The time this image has been made publicly available.||
|| owner        || String ||(New in 7.1.) The UUID of the user who owns this image.||
|| public       || Boolean ||(New in 7.1.) Indicates if this image is publicly available.||
|| state        || String ||(New in 7.1.) The current state of the image. One of 'active', 'unactivated', 'disabled', 'creating', 'failed'.||
|| tags         || Object ||(New in 7.1.) An object of key/value pairs that allows clients to categorize images by any given criteria.||
|| eula         || String ||(New in 7.1.) URL of the End User License Agreement (EULA) for the image.||
|| acl          || Array ||(New in 7.1.) Access Control List. An array of account UUIDs given access to a private image. The field is only relevant to private images.||
|| error        || Object ||(New in 7.1.) If `state=="failed"`, resulting from [CreateImageFromMachine](#CreateImageFromMachine) failure, then there may be an error object of the form `{"code": "<string error code>", "message": "<string desc>"}`||
|| error.code   || String ||(New in 7.1.) A CamelCase string code for this error, e.g. "PrepareImageDidNotRun". See [GetImage](#GetImage) docs for a table of error.code values.||
|| error.message|| String ||(New in 7.1.) A short description of the image creation failure.||

<!-- TODO: list possible error.code values, link to troubleshooting docs -->

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `login` does not exist||

### CLI Command

    $ sdc-listimages

### Example Request

    GET /my/images HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 OK
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET
    Server: SmartDataCenter
    Connection: close
    Date: Tue, 28 Jun 2011 23:14:34 GMT
    X-Api-Version: 7.0.0
    X-RequestId: FD6F87E7-5EA5-4B55-97D9-DEE29259731D
    X-Response-Time: 257
    Content-Type: application/json
    Content-Length: 402
    Content-MD5: y7YOeXG98DYchC96s46yRw==

    [
      {
        "name": "nodejs",
        "version": "1.1.3",
        "os": "smartos",
        "id": "7456f2b0-67ac-11e0-b5ec-832e6cf079d5",
        "default": true,
        "type": "smartmachine",
        "published_at": "2011-04-15T22:04:12+00:00"
      },
      {
        "name": "smartos",
        "version": "1.3.12",
        "os": "smartos",
        "id": "febaa412-6417-11e0-bc56-535d219f2590",
        "default": false,
        "type": "smartmachine",
        "published_at": "2011-04-11T08:45:00+00:00"
      }
    ]


## GetImage (GET /:login/images/:id)

Gets an individual image by `id`.

### Inputs

None

### Returns

|| **Field**    ||**Type**||**Description**||
|| id           || String ||A unique identifier for this image||
|| name         || String ||The "friendly" name for this image||
|| os           || String ||The underlying operating system for this image||
|| version      || String ||The version for this image||
|| type         || String ||Whether this is a smartmachine or virtualmachine dataset||
|| requirements || Object ||Contains a grouping of various minimum requirements for provisioning a machine with this image. For example 'password' indicates that a password must be provided.||
|| homepage     || String ||(New in 7.0.) The URL for a web page with more detailed information for this image||
|| files        || Array  ||(New in 7.1.) An array of image files that make up each image. Currently only a single file per image is supported.||
|| files[0].compression     || String ||(New in 7.1.) The type of file compression used for the image file. One of 'bzip2', 'gzip', 'none'.||
|| files[0].sha1     || String ||(New in 7.1.) SHA-1 hex digest of the file content. Used for corruption checking.||
|| files[0].size     || Number ||(New in 7.1.) File size in bytes.||
|| published_at || String (ISO-8859) ||(New in 7.0.) The time this image has been made publicly available.||
|| owner        || String ||(New in 7.1.) The UUID of the user who owns this image.||
|| public       || Boolean ||(New in 7.1.) Indicates if this image is publicly available.||
|| state        || String ||(New in 7.1.) The current state of the image. One of 'active', 'unactivated', 'disabled', 'creating', 'failed'.||
|| tags         || Object ||(New in 7.1.) An object of key/value pairs that allows clients to categorize images by any given criteria.||
|| eula         || String ||(New in 7.1.) URL of the End User License Agreement (EULA) for the image.||
|| acl          || Array ||(New in 7.1.) Access Control List. An array of account UUIDs given access to a private image. The field is only relevant to private images.||
|| error        || Object ||(New in 7.1.) If `state=="failed"`, resulting from [CreateImageFromMachine](#CreateImageFromMachine) failure, then there may be an error object of the form `{"code": "<string error code>", "message": "<string desc>"}`||
|| error.code   || String ||(New in 7.1.) A CamelCase string code for this error, e.g. "PrepareImageDidNotRun". See [GetImage](#GetImage) docs for a table of error.code values.||
|| error.message|| String ||(New in 7.1.) A short description of the image creation failure.||

Possible `error.code` values:

|| **error.code** || **Details** ||
|| PrepareImageDidNotRun || This typically means that the target KVM machine (e.g. Linux) has old guest tools that pre-date the image creation feature. Guest tools can be upgraded with installers at <https://download.joyent.com/pub/guest-tools/>. Other possibilities are: a boot time greater than the five-minute timeout, or a bug or crash in the image-preparation script. ||
|| VmHasNoOrigin || Origin image data could not be found for the machine. Typically this is for a machine *migrated* before image creation support was added. ||
|| NotSupported  || Indicates an error due to functionality that isn't currently supported. One example is that custom image creation of a VM based on a custom image isn't currently supported. ||
|| InternalError || A catch-all error for unexpected or internal errors. ||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

### CLI Command

    $ sdc-getimage e42f8c84-bbea-11e2-b920-078fab2aab1f

#### Example Request

    GET /my/images/e42f8c84-bbea-11e2-b920-078fab2aab1f HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

#### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Content-Length: 340
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    Access-Control-Allow-Methods: GET, HEAD, POST
    Access-Control-Expose-Headers: Api-Version, Request-Id, Response-Time
    Connection: Keep-Alive
    Content-MD5: Q4ibyY8+ckGrTqyr/sbYLw==
    Date: Thu, 08 Aug 2013 06:02:49 GMT
    Server: Joyent SmartDataCenter 7.0.0
    Api-Version: 7.0.0
    Request-Id: 27431d80-fff0-11e2-b61a-f51841e5d1bd
    Response-Time: 491
    X-Request-Id: 27431d80-fff0-11e2-b61a-f51841e5d1bd
    X-Api-Version: 7.0.0
    X-Response-Time: 491

    {
      "id": "e42f8c84-bbea-11e2-b920-078fab2aab1f",
      "name": "fedora",
      "version": "2.4.2",
      "os": "linux",
      "type": "virtualmachine",
      "requirements": {},
      "description": "Fedora 18 64-bit image with just essential...",
      "published_at": "2013-05-17T18:18:36.472Z",
      "public": true
      "state": "active",
    }


## DeleteImage (DELETE /:login/images/:id)

(**Beta.** Custom image management is currently in beta.)

Delete an image.  One must be the owner of the image to delete it.

### Inputs

None

### Returns

Responds with HTTP 204 'No Content'.

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI Command

    $ sdc-deleteimage 0c428eb9-7f03-4bb0-ac9f-c0718945d604

#### Example Request

    DELETE /my/images/e42f8c84-bbea-11e2-b920-078fab2aab1f HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

#### Example Response

    HTTP/1.1 204 No Content
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    Access-Control-Allow-Methods: GET, HEAD, DELETE
    Access-Control-Expose-Headers: Api-Version, Request-Id, Response-Time
    Connection: Keep-Alive
    Date: Sat, 10 Aug 2013 00:43:33 GMT
    Server: Joyent SmartDataCenter 7.0.0
    Api-Version: 7.0.0
    Request-Id: e23eeef0-0155-11e3-8fd4-39aa5371c390
    Response-Time: 244
    X-Request-Id: e23eeef0-0155-11e3-8fd4-39aa5371c390
    X-Api-Version: 7.0.0
    X-Response-Time: 244


## ExportImage (POST /:login/images/:id?action=export)

(**Beta.** Custom image management is currently in beta.)

Exports an image to the specified Manta path.  One must be the owner of the
image and the correspondent Manta path prefix in order to export it.  Both the
image manifest and the image file will be exported, and their filenames will
default to the following format when the specified manta path is a directory:

    <manta_path>/NAME-VER.imgmanifest
    <manta_path>/NAME-VER.zfs.FILE-EXT

Where NAME is the image name and VER is the image version.  FILE-EXT is the file
extension of the image file.  As an example, exporting a foo-1.0.0 image to
/user/stor/cloudapi would result in the following files being exported:

    /user/stor/cloudapi/foo-1.0.0.imgmanifest
    /user/stor/cloudapi/foo-1.0.0.zfs.gz

By contrast, if the basename of the given prefix is not a directory, then
"MANTA_PATH.imgmanifest" and "MANTA_PATH.zfs[.EXT]" are created.  As an example,
the following shows how to export foo-1.0.0 with a custom name:

    /my/images/<uuid>?action=export&manta_path=/user/stor/my-image

    /user/stor/my-image.imgmanifest
    /user/stor/my-image.zfs.gz

### Inputs

||**Field** ||**Type**||**Description**||
||manta_path||String||The Manta path prefix to use when exporting the image.||

### Returns

A Manta location response object.  It provides the properties that allow a
CloudAPI user to retrieve the image file and manifest from Manta: manta_url,
image_path, manifest_path.

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI Command

    $ sdc-exportimage --mantaPath=/user/stor/my-image 0c428eb9-7f03-4bb0-ac9f-c0718945d604

#### Example Request

    POST /my/images/e42f8c84-bbea-11e2-b920-078fab2aab1f?action=export&manta_path=/user/stor/my-image HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

#### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Content-Length: 150
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    Access-Control-Allow-Methods: GET, HEAD, POST, DELETE
    Access-Control-Expose-Headers: Api-Version, Request-Id, Response-Time
    Connection: Keep-Alive
    Content-MD5: qSUhN+dwdJKEFlcyrUdBiw==
    Date: Tue, 03 Sep 2013 23:21:05 GMT
    Server: Joyent SmartDataCenter 7.1.0
    Api-Version: 7.1.0
    Request-Id: 8180ad80-14ef-11e3-a62d-89e8106c294e
    Response-Time: 670
    X-Request-Id: 8180ad80-14ef-11e3-a62d-89e8106c294e
    X-Api-Version: 7.1.0
    X-Response-Time: 670

    {
      "manta_url": "https://us-east.manta.joyent.com",
      "image_path": "/user/stor/my-image.zfs.gz",
      "manifest_path": "/user/stor/my-image.imgmanifest"
    }


## CreateImageFromMachine (POST /:login/images)

(**Beta.** Custom image management is currently in beta.)

Create a new custom image from a machine.  The typical process is:

1. Customize a machine so it's the way you want it.
2. Call this endpoint to create the new image.
3. ... repeat from step 1 if more customizations are desired with different images.
4. Use the new image(s) for provisioning via [CreateMachine](#CreateMachine).

### Inputs

All inputs except `machine` are image manifest fields as defined by
[the IMGAPI docs](https://images.joyent.com/docs/#image-manifests).  Note that
not all fields listed there can be specified here.

||**Field**||**Type**||**Required?**||**Default**||**Notes**||
||machine||UUID||Yes||-||The prepared and stopped machine UUID from which the image is to be created.||
||name||String||Yes||-||The name of the custom image, e.g. "my-image". See the [IMGAPI docs](https://images.joyent.com/docs/#manifest-name) for details.||
||version||String||Yes||-||The version of the custom image, e.g. "1.0.0". See the [IMGAPI docs](https://images.joyent.com/docs/#manifest-version) for details.||
||description||String||No||-||The image [description](https://images.joyent.com/docs/#manifest-description).||
||homepage||String||No||-||The image [homepage](https://images.joyent.com/docs/#manifest-homepage).||
||eula||String||No||-||The image [eula](https://images.joyent.com/docs/#manifest-eula).||
||acl||String||No||-||The image [acl](https://images.joyent.com/docs/#manifest-acl).||
||tags||String||No||-||The image [tags](https://images.joyent.com/docs/#manifest-tags).||

### Returns

|| **Field**    ||**Type**||**Description**||
|| id           || String ||A unique identifier for this image||
|| name         || String ||The "friendly" name for this image||
|| os           || String ||The underlying operating system for this image||
|| version      || String ||The version for this image||
|| type         || String ||Whether this is a smartmachine or virtualmachine dataset||
|| requirements || Object ||Contains a grouping of various minimum requirements for provisioning a machine with this image. For example 'password' indicates that a password must be provided.||
|| homepage     || String ||(New in 7.0.) The URL for a web page with more detailed information for this image||
|| files        || Array  ||(New in 7.1.) An array of image files that make up each image. Currently only a single file per image is supported.||
|| files[0].compression     || String ||(New in 7.1.) The type of file compression used for the image file. One of 'bzip2', 'gzip', 'none'.||
|| files[0].sha1     || String ||(New in 7.1.) SHA-1 hex digest of the file content. Used for corruption checking.||
|| files[0].size     || Number ||(New in 7.1.) File size in bytes.||
|| published_at || String (ISO-8859) ||(New in 7.0.) The time this image has been made publicly available.||
|| owner        || String ||(New in 7.1.) The UUID of the user who owns this image.||
|| public       || Boolean ||(New in 7.1.) Indicates if this image is publicly available.||
|| state        || String ||(New in 7.1.) The current state of the image. One of 'active', 'unactivated', 'disabled', 'creating', 'failed'.||
|| tags         || Object ||(New in 7.1.) An object of key/value pairs that allows clients to categorize images by any given criteria.||
|| eula         || String ||(New in 7.1.) URL of the End User License Agreement (EULA) for the image.||
|| acl          || Array ||(New in 7.1.) Access Control List. An array of account UUIDs given access to a private image. The field is only relevant to private images.||

### Errors

For general errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).
Some typical and specific errors for this endpoint:

|| **Code** || **HTTP Status** || **Description** ||
|| InsufficientServerVersionError || 422 || The `machine` given is running on a server that is too old. ||
|| NotAvailable || 501 || Typically this indicates that image creation is not supported for the OS of the given VM. ||

<!-- TODO: integrate these errors into the general table above -->

### Example CLI Command

    $ sdc-createimagefrommachine --machine=a44f2b9b-e7af-f548-b0ba-4d9270423f1a --name=my-custom-image --imageVersion=1.0.0

#### Example HTTP Request

    POST /my/images HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

    {
      "machine": "a44f2b9b-e7af-f548-b0ba-4d9270423f1a",
      "name": "my-custom-image",
      "version": "1.0.0"
    }

#### Example HTTP Response

    HTTP/1.1 201 Created
    x-joyent-jobid: 0b30ef20-d622-436a-9c30-7376ba7d904c
    Location: /admin/images/b87616a2-7a49-4e02-a71d-2e0ce5a2f037
    Content-Type: application/json
    Content-Length: 125
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    Access-Control-Allow-Methods: GET, HEAD, POST
    Access-Control-Expose-Headers: Api-Version, Request-Id, Response-Time
    Connection: Keep-Alive
    Content-MD5: 2sEZ45LmhRiretMPn5sqVA==
    Date: Tue, 30 Jul 2013 19:59:25 GMT
    Server: Joyent SmartDataCenter 7.0.0
    Api-Version: 7.0.0
    Request-Id: 88af23b0-f952-11e2-8f2c-fff0ec35f4ce
    Response-Time: 160
    X-Request-Id: 88af23b0-f952-11e2-8f2c-fff0ec35f4ce
    X-Api-Version: 7.0.0
    X-Response-Time: 160

    {
        "id": "62306cd7-7b8a-c5dd-d44e-8491c83b9974",
        "name": "my-custom-image",
        "version": "1.2.3",
        "requirements": {},
        "owner": "47034e57-42d1-0342-b302-00db733e8c8a",
        "public": false,
        "state": "creating"
    }


## UpdateImage (POST /:login/images/:id?action=update)

(**Beta.** Custom image management is currently in beta.)

Updates metadata about an image.

### Inputs

Only the image attributes listed below can be updated.

||**Field**||**Type**||**Notes**||
||name||String||Name of the image, e.g. "my-image". See the [IMGAPI docs](https://images.joyent.com/docs/#manifest-name) for details.||
||version||String||Version of the image, e.g. "1.0.0". See the [IMGAPI docs](https://images.joyent.com/docs/#manifest-version) for details.||
||description||String||The image [description](https://images.joyent.com/docs/#manifest-description).||
||homepage||String||The image [homepage](https://images.joyent.com/docs/#manifest-homepage).||
||eula||String||The image [eula](https://images.joyent.com/docs/#manifest-eula).||
||acl||String||The image [acl](https://images.joyent.com/docs/#manifest-acl).||
||tags||String||The image [tags](https://images.joyent.com/docs/#manifest-tags).||

### Returns

An updated image object.

|| **Field**    ||**Type**||**Description**||
|| id           || String ||A unique identifier for this image||
|| name         || String ||The "friendly" name for this image||
|| os           || String ||The underlying operating system for this image||
|| version      || String ||The version for this image||
|| type         || String ||Whether this is a smartmachine or virtualmachine dataset||
|| requirements || Object ||Contains a grouping of various minimum requirements for provisioning a machine with this image. For example 'password' indicates that a password must be provided.||
|| homepage     || String ||(New in 7.0.) The URL for a web page with more detailed information for this image||
|| files        || Array  ||(New in 7.1.) An array of image files that make up each image. Currently only a single file per image is supported.||
|| files[0].compression     || String ||(New in 7.1.) The type of file compression used for the image file. One of 'bzip2', 'gzip', 'none'.||
|| files[0].sha1     || String ||(New in 7.1.) SHA-1 hex digest of the file content. Used for corruption checking.||
|| files[0].size     || Number ||(New in 7.1.) File size in bytes.||
|| published_at || String (ISO-8859) ||(New in 7.0.) The time this image has been made publicly available.||
|| owner        || String ||(New in 7.1.) The UUID of the user who owns this image.||
|| public       || Boolean ||(New in 7.1.) Indicates if this image is publicly available.||
|| state        || String ||(New in 7.1.) The current state of the image. One of 'active', 'unactivated', 'disabled', 'creating', 'failed'.||
|| tags         || Object ||(New in 7.1.) An object of key/value pairs that allows clients to categorize images by any given criteria.||
|| eula         || String ||(New in 7.1.) URL of the End User License Agreement (EULA) for the image.||
|| acl          || Array ||(New in 7.1.) Access Control List. An array of account UUIDs given access to a private image. The field is only relevant to private images.||

### Errors

For general errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).
Some typical and specific errors for this endpoint:

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### Example CLI Command

    $ sdc-updateimage --name=my-renamed-image eca995fe-b904-11e3-b05a-83a4899322dc

#### Example HTTP Request

    POST /my/images/eca995fe-b904-11e3-b05a-83a4899322dc?action=update HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

    {
      "name": "my-renamed-image",
    }

#### Example HTTP Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    ...
    Request-Id: b8e43c60-b904-11e3-93b7-1f685001b0c3
    Response-Time: 135
    X-Request-Id: b8e43c60-b904-11e3-93b7-1f685001b0c3
    X-Api-Version: 7.2.0
    X-Response-Time: 135

    {
      "id": "eca995fe-b904-11e3-b05a-83a4899322dc",
      "name": "my-renamed-image",
      "version": "1.0.0",
      "os": "smartos",
      "requirements": {},
      "type": "smartmachine",
      "published_at": "2013-11-25T17:44:54Z",
      "owner": "47034e57-42d1-0342-b302-00db733e8c8a",
      "public": true,
      "state": "active"
    }




# Packages

[Packages](#packages-description) are named collections of resources that are
used to describe the dimensions of either a smart machine or a virtual machine.
These resources include (but are not limited to) RAM size, CPUs, CPU caps,
lightweight threads, disk space, swap size, and logical networks.

## ListPackages (GET /:login/packages)

Provides a list of packages available in this datacenter.

### Inputs

* The following are all optional inputs:

||name||String||The "friendly" name for this package||
||memory||Number||How much memory will by available (in MiB)||
||disk||Number||How much disk space will be available (in MiB)||
||swap||Number||How much swap space will be available (in MiB)||
||lwps||Number||Maximum number of light-weight processes (threads) allowed||
||version||String||The version of this package||
||vcpus||Number||Number of vCPUs for this package||
||group||String||The group this package belongs to||

When any value is provided for one or more of the aforementioned inputs, the
retrieved packages will match all of them.

### Returns

An array of objects, of the form:

||name||String||The "friendly" name for this package||
||memory||Number||How much memory will by available (in MiB)||
||disk||Number||How much disk space will be available (in MiB)||
||swap||Number||How much swap space will be available (in MiB)||
||lwps||Number||Maximum number of light-weight processes (threads) allowed||
||vcpus||Number||Number of vCPUs for this package||
||default||Boolean||Whether this is the default package in this datacenter||
|id||String||Unique identifier for this package||
||version||String||The version of this package||
||group||String||The group this package belongs to||
||description||String||A human-friendly description about this package||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` does not exist||

### CLI Command

    $ sdc-listpackages

### Example Request

    GET /my/packages HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 OK
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET
    Server: SmartDataCenter
    Connection: close
    Date: Tue, 28 Jun 2011 23:14:34 GMT
    X-Api-Version: 7.0.0
    X-RequestId: FD6F87E7-5EA5-4B55-97D9-DEE29259731D
    X-Response-Time: 257
    Content-Type: application/json
    Content-Length: 402
    Content-MD5: y7YOeXG98DYchC96s46yRw==

    [
      {
        "name": "regular_128",
        "id": "5968a8a4-5bff-4c5e-8034-d79de962e7f6",
        "memory": 128,
        "disk": 5120,
        "swap": 256,
        "lwps": 1000,
        "version": "1.0.0",
        "vcpus": 1,
        "default": true
      },
      {
        "name": "regular_256",
        "id": "ebb5dffb-04fd-487f-bd03-581ade19f717",
        "memory": 256,
        "disk": 5120,
        "swap": 512,
        "lwps": 2000,
        "version": "1.0.0",
        "default": false
      },
      {
        "name": "regular_512",
        "id": "4dad8aa6-2c7c-e20a-be26-c7f4f1925a9a",
        "memory": 512,
        "disk": 10240,
        "swap": 1024,
        "lwps": 2000,
        "version": "1.0.1",
        "default": false
      },
      {
        "name": "regular_1024",
        "id": "9fcd9ab7-bd07-cb3c-9f9a-ac7ec3aa934e",
        "memory": 1024,
        "disk": 15360,
        "swap": 2048,
        "lwps": 4000,
        "version": "1.2.0",
        "default": false
      }
    ]

## GetPackage (GET /:login/packages/:id)

Gets a package by `name` or `id`.

### Inputs

* None

### Returns

||name||String||The "friendly" name for this package||
||memory||Number||How much memory will by available (in MiB)||
||disk||Number||How much disk space will be available (in MiB)||
||swap||Number||How much swap space will be available (in MiB)||
||vcpus||Number||Number of vCPUs for this package||
||lwps||Number||Maximum number of light-weight processes (threads) allowed||
||default||Boolean||Whether this is the default package in this datacenter||
||id||String||Unique identifier for this package||
||version||String||The version of this package||
||group||String||The group this package belongs to||
||description||String||A human-friendly description about this package||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI Command

    $ sdc-getpackage 5968a8a4-5bff-4c5e-8034-d79de962e7f6

### Example Request

    GET /my/packages/5968a8a4-5bff-4c5e-8034-d79de962e7f6 HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 OK
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET
    Server: SmartDataCenter
    Connection: close
    Date: Tue, 16 Oct 2012 23:14:34 GMT
    X-Api-Version: 7.0.0
    X-RequestId: F01F0DC1-12DE-4D9A-B92B-FB3A041E46B8
    X-Response-Time: 120
    Content-Type: application/json
    Content-Length: 122
    Content-MD5: aokYYCYw/EU8JwTD9F6PyA==

    {
      "name": "regular_128",
      "memory": 128,
      "swap": 256,
      "disk": 5120,
      "lwps": 1000,
      "default": true,
      "id": "5968a8a4-5bff-4c5e-8034-d79de962e7f6",
      "vcpus": 1,
      "version": "1.0.0"
    }




# Machines

## ListMachines (GET /:login/machines)

Lists all machines we have on record for your account.  If you have a large
number of machines, you can filter using the input parameters listed below.

You can paginate this API by passing in `offset` and `limit`.  HTTP responses
will contain the additional headers `x-resource-count` and `x-query-limit`.  If
`x-resource-count` is less than `x-query-limit`, you're done, otherwise call the
API again with `offset` set to `offset` + `limit` to fetch additional machines.

Note that there is a `HEAD /:login/machines` form of this API, so you can
retrieve the number of machines without retrieving a JSON describing the
machines themselves.

### Inputs

||type||String||The type of machine (virtualmachine or smartmachine)||
||name||String||Machine name to find (will make your list size 1, or 0 if nothing found)||
||image||String||Image id; returns machines provisioned with that image||
||state||String||The current state of the machine (e.g. running)||
||memory||Number||The current size of the RAM deployed for the machine (in MiB)||
||tombstone||Number||Include machines destroyed in the last N minutes||
||limit||Number||Return a max of N machines; default is 1000 (which is also the maximum allowable result set size)||
||offset||Number||Get a `limit` number of machines starting at this `offset`||
||tag.$name||String||An arbitrary set of tags can be used for querying, assuming they are prefixed with "tag."||
||credentials||Boolean||Whether to include the generated credentials for machines, if present. Defaults to false.||

Note that if the special input `tags=*` is provided, any other input will be
completely ignored and the response will return all machines with any tag.

### Returns

An array of machine objects, which contain:

||id||String||Unique identifier for this machine||
||name||String||The "friendly" name for this machine||
||type||String||The type of machine (virtualmachine or smartmachine)||
||state||String||The current state of this machine (e.g. running)||
||dataset||URN||The dataset urn this machine was provisioned with (for new images without a URN, this value will be the image id)||
||memory||Number||The amount of RAM this machine has (in MiB)||
||disk||Number||The amount of disk this machine has (in MiB)||
||ips||Array[String]||The IP addresses this machine has||
||metadata||Object[String => String]||Any additional metadata this machine has||
||created||Date (ISO8601)||When this machine was created||
||updated||Date (ISO8601)||When this machine was last updated||
||package||String||The id or name of the package used to create this machine||
||image||String||The image id this machine was provisioned with||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` does not exist||
||InvalidArgument||If one of the input parameters was invalid||

### CLI Command

Get all machines:

    $ sdc-listmachines

Get all SmartMachines:

    $ sdc-listmachines --type smartmachine

Get all SmartMachines that are currently running:

    $ sdc-listmachines --type smartmachine --state running

Get all SmartMachines that are currently running and have 256 MiB of memory:

    $ sdc-listmachines --type smartmachine --state running --memory 256

Get all SmartMachines that are currently running, with 256 MiB of RAM, tagged as
'test':

    $ sdc-listmachines --type smartmachine --state running --memory 256 --tag group=test

Get all tagged machines:

    $ sdc-listmachines --tag \*

Beware that depending on your shell you may need to escape the asterisk
character. E.g. Bash requires it escaped.

The CLI has parameters that let you filter on most things in the API, and you
can combine them.  Run `$ sdc-listmachines --help` to see all the options.

### Example Request

    GET /my/machines HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 OK
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Server: SmartDataCenter
    Connection: close
    Date: Tue, 28 Jun 2011 23:14:34 GMT
    X-Api-Version: 7.0.0
    X-RequestId: AECD793C-3368-45FA-ACD9-19AC394B8933
    X-Response-Time: 315
    x-resource-count: 2
    x-query-limit: 25
    Content-Type: application/json
    Content-Length: 292
    Content-MD5: kGRcBWkLgMT+IAjDM46rFg==

    [
      {
        "id": "15080eca-3786-4bb8-a4d0-f43e1981cd72",
        "name": "getting-started",
        "type": "smartmachine",
        "state": "running",
        "dataset": "sdc:sdc:smartos:1.3.15",
        "image": "01b2c898-945f-11e1-a523-af1afbe22822",
        "memory": 256,
        "disk": 5120,
        "ips": [
          "10.88.88.50"
        ],
        "metadata": {},
        "created": "2011-06-03T00:02:31+00:00",
        "updated": "2011-06-03T00:02:31+00:00"
      }
    ]


## GetMachine (GET /:login/machines/:id)

Gets the details for an individual machine.

### Inputs

* None

### Returns

||id||String||Unique identifier for this machine||
||name||String||The "friendly" name for this machine||
||type||String||The type of machine (virtualmachine or smartmachine)||
||state||String||The current state of this machine (e.g. running)||
||dataset||URN||The dataset urn this machine was provisioned with (for new images without a URN, this value will be the image id)||
||memory||Number||The amount of RAM this machine has (in MiB)||
||disk||Number||The amount of disk this machine has (in MiB)||
||ips||Array[String]||The IP addresses this machine has||
||metadata||Object[String => String]||Any additional metadata this machine has||
||created||Date (ISO8601)||When this machine was created||
||updated||Date (ISO8601)||When this machine was last updated||
||package||String||The id or name of the package used to create this machine||
||image||String||The image id this machine was provisioned with||
||credentials||Boolean||Whether to include the generated credentials for machines, if present. Defaults to false.||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI Command

Get the details for the machine with id 75cfe125-a5ce-49e8-82ac-09aa31ffdf26:

    $ sdc-getmachine 75cfe125-a5ce-49e8-82ac-09aa31ffdf26

### Example Request

    GET /my/machines/75cfe125-a5ce-49e8-82ac-09aa31ffdf26 HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 OK
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Server: SmartDataCenter
    Connection: close
    Date: Tue, 28 Jun 2011 23:14:34 GMT
    X-Api-Version: 7.0.0
    X-RequestId: 4A8C4694-03C3-484D-80E0-ACBA9FEE6C7C
    X-Response-Time: 174
    Content-Type: application/json
    Content-Length: 261
    Content-MD5: oDccU7ZWZrOkdl/pGZ4oNA==

    {
      "id": "75cfe125-a5ce-49e8-82ac-09aa31ffdf26",
      "name": "getting-started",
      "type": "smartmachine",
      "state": "running",
      "dataset": "sdc:sdc:smartos:1.3.15",
      "image": "01b2c898-945f-11e1-a523-af1afbe22822",
      "ips": [
        "10.88.88.51"
      ],
      "memory": 128,
      "disk": 5120,
      "metadata": {},
      "created": "2011-06-27T23:50:49+00:00",
      "updated": "2011-06-28T00:09:37+00:00"
    }


## CreateMachine (POST /:login/machines)

Allows you to provision a machine.

If you do not specify a package and/or dataset, you'll get the datacenter
defaults for each.  If you do not specify a name, CloudAPI will generate a
random one for you.

> **NOTE:**<br />
CreateMachine no longer returns IP addresses as of SDC 7.0.  To obtain the IP
address of a newly-provisioned machine, poll [ListMachines](#ListMachines) or
[GetMachine](#GetMachine) until the machine state is `running` or a failure.

Your machine will initially be not available for login (SmartDataCenter must
provision and boot it); you can poll [GetMachine](#GetMachine) for status.
When the `state` field is equal to `running`, you can log in. If the machine is
of type `smartmachine`, you can use any of the SSH keys managed under the
[keys section](#keys) of CloudAPI to login as any POSIX user on the OS.  You can
add/remove keys over time, and the machine will automatically work with that
set.

If the the machine is a `virtualmachine`, and of a UNIX-derived OS (e.g. Linux),
you *must* have keys uploaded before provisioning; that entire set of keys will
be written out to `/root/.ssh/authorized_keys`, and you can SSH in using one of
those.  Changing the keys over time under your account will not affect a
running virtual machine in any way; those keys are statically written at
provisioning-time only, and you will need to manually manage them on the machine
itself.

If the image you create a machine from is set to generate passwords for you,
the username/password pairs will be returned in the metadata response as a
nested object, like:

    "metadata": {
      "credentials": {
        "root": "s8v9kuht5e",
        "admin": "mf4bteqhpy"
      }
    }

You cannot overwrite the `credentials` key in CloudAPI.

More generally, the metadata keys can be set either at machine-creation time
or after the fact.  You must either pass in plain-string values, or a JSON
encoded string.  On metadata retrieval, you will get back a JSON object.

Networks are usually provided by the package, although they can be specified
using the networks attribute. If neither the package, nor the inputs, contains
an array of networks the machine should attach to, the machine will default to
attaching to one externally-accessible network (it will have one public
IP), and one internally-accessible network. This behaviour can be overridden by
specifying 'external' and/or 'internal' in a default_networks array. Ergo, it's
possible to have a machine only attached to an internal network, or both public
and internal, or just external. NB: 'internal' cannot be reached from the
Internet, but all users also on the internal network can reach it.

Typically, SDC will allocate the new machine somewhere reasonable within the
cloud.  You may want this machine to be placed close to, or far away from, other
existing machines belonging to you;  if so, you can provide locality hints to
cloudapi.  Locality hints are not guarantees, but SDC will attempt to satisfy
the hints if possible. An example of a locality hint is:

    "locality": {
      "near": ["af7ebb74-59be-4481-994f-f6e05fa53075"],
      "far": ["da568166-9d93-42c8-b9b2-bce9a6bb7e0a", "d45eb2f5-c80b-4fea-854f-32e4a9441e53"]
    }

UUIDs provided should be the ids of machines belonging to you.

Locality hints are optional. Both `near` and `far` are also optional; you can
provide just one if desired. Lastly, if there's only a single UUID entry in an
array, you can omit the array and provide the UUID string directly as the value
to a near/far key.

### Inputs

||name||String||Friendly name for this machine; default is a randomly generated name||
||package||String||Id of the package to use on provisioning; default is indicated in ListPackages||
||image||String||The image UUID (the "id" field in [ListImages](#ListImages))||
||networks||Array||Desired networks ids, obtained from ListNetworks||
||default_networks||Array||Alter the default networks IPs are drawn from if Inputs or the package have no networks||
||locality||Object[String => Array]||Optionally specify which machines the new machine should be near or far from||
||metadata.$name||String||An arbitrary set of metadata key/value pairs can be set at provision time, but they must be prefixed with "metadata."||
||tag.$name||String||An arbitrary set of tags can be set at provision time, but they must be prefixed with "tag."||
||firewall_enabled||Boolean||(Added in SDC 7.0.)Completely enable or disable firewall for this machine||

### Returns

||id||String||Unique identifier for this machine||
||name||String||The "friendly" name for this machine||
||type||String||The type of machine (virtualmachine or smartmachine)||
||state||String||The current state of this machine (e.g. running)||
||dataset||URN||The dataset urn this machine was provisioned with (for new images without a URN, this value will be the image id)||
||memory||Number||The amount of RAM this machine has (in MiB)||
||disk||Number||The amount of disk this machine has (in MiB)||
||ips||Array[String]||The IP addresses this machine has||
||metadata||Object[String => String]||Any additional metadata this machine has||
||created||Date (ISO8601)||When this machine was created||
||updated||Date (ISO8601)||When this machine was last updated||
||package||String||The name of the package used to create this machine||
||image||String||The image id this machine was provisioned with||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` does not exist||
||InsufficientCapacity||There isn't enough capacity in this datacenter||
||InvalidArgument||If one of the input parameters was invalid||

### CLI Command

    $ sdc-createmachine --image=01b2c898-945f-11e1-a523-af1afbe22822 --package=5968a8a4-5bff-4c5e-8034-d79de962e7f6

### Example Request

    POST /my/machines HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 455
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 201 Created
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Server: Joyent
    Connection: close
    Date: Wed, 13 Apr 2011 23:12:39 GMT
    X-Api-Version: 7.0.0
    X-RequestId: 04BF964B-C285-4BDF-84B1-762B8FDCADB1
    X-Response-Time: 470
    Content-Type: application/json
    Content-Length: 197
    Content-MD5: yuUKkqnVw/ZtHXTTeoWVDQ==

    {
      "id": "55a366ce-6c30-4f88-a36b-53638bd0cb62",
      "name": abcd1234",
      "type": "smartmachine",
      "state": "provisioning",
      "dataset": nodejs-1.1.4",
      "image": "01b2c898-945f-11e1-a523-af1afbe22822",
      "memory": 128,
      "disk": 5120,
      "ips": [],
      "metadata": {},
      "created": "2011-06-03T00:02:31+00:00",
      "updated": "2011-06-03T00:02:31+00:00",
    }

### More Examples

Create machine with multiple nics

    $ sdc-createmachine --image=01b2c898-945f-11e1-a523-af1afbe22822 --package=5968a8a4-5bff-4c5e-8034-d79de962e7f6 --networks=42325ea0-eb62-44c1-8eb6-0af3e2f83abc --networks=c8cde927-6277-49ca-82a3-741e8b23b02f

Create machine with tags

    $ sdc-createmachine --image=01b2c898-945f-11e1-a523-af1afbe22822 --package=5968a8a4-5bff-4c5e-8034-d79de962e7f6 --networks=42325ea0-eb62-44c1-8eb6-0af3e2f83abc -t foo=bar -t group=test

### User-script

The special value `metadata.user-script` can be specified to provide a custom
script which will be executed by the machine right after creation.  This script
can be specified using the command line option `--script`, which should be an
absolute path to the file we want to upload to our machine.


## StopMachine (POST /:login/machines/:id?action=stop)

Allows you to shut down a machine.  POST to the machine name with an `action` of
`stop`.

You can poll on [GetMachine](#GetMachine) until the state is `stopped`.

### Inputs

||action||String||Use the exact string "stop"||

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||
||InvalidState||The machine is in the wrong state to be stopped||
||InvalidArgument||If `action` was invalid||
||MissingParameter||If `action` wasn't provided||

### CLI Command

    $ sdc-stopmachine 75cfe125-a5ce-49e8-82ac-09aa31ffdf26

### Example Request

    POST /my/machines/75cfe125-a5ce-49e8-82ac-09aa31ffdf26 HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 12
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

    action=stop

### Example Response

    HTTP/1.1 202 Accepted
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Server: SmartDataCenter
    Connection: close
    Date: Wed, 13 Apr 2011 23:35:25 GMT
    X-Api-Version: 7.0.0
    X-RequestId: F09F3674-2151-434B-9911-29DD188057F0
    X-Response-Time: 115
    Content-Length: 0


## StartMachine (POST /:login/machines/:id?action=start)

Allows you to boot up a machine.  POST to the machine name with an `action` of
`start`.

You can poll on [GetMachine](#GetMachine) until the state is `running`.

### Inputs

||action||String||Use the exact string "start"||

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||
||InvalidState||The machine is in the wrong state to be started||
||InvalidArgument||If `action` was invalid||
||MissingParameter||If `action` wasn't provided||

### CLI Command

    $ sdc-startmachine 75cfe125-a5ce-49e8-82ac-09aa31ffdf26

### Example Request

    POST /my/machines/75cfe125-a5ce-49e8-82ac-09aa31ffdf26 HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 12
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

    action=start

### Example Response

    HTTP/1.1 202 Accepted
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Server: SmartDataCenter
    Connection: close
    Date: Wed, 13 Apr 2011 23:35:25 GMT
    X-Api-Version: 7.0.0
    X-RequestId: F09F3674-2151-434B-9911-29DD188057F0
    X-Response-Time: 115
    Content-Length: 0


## RebootMachine (POST /:login/machines/:id?action=reboot)

Allows you to 'reboot' a machine.  POST to the machine name with an `action` of
`reboot`.

You can poll on [GetMachine](#GetMachine) until the state is `running`.

### Inputs

||action||String||Use the exact string "reboot"||

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||
||InvalidState||The machine is in the wrong state to be stopped||
||InvalidArgument||If `action` was invalid||
||MissingParameter||If `action` wasn't provided||

### CLI Command

    $ sdc-rebootmachine 75cfe125-a5ce-49e8-82ac-09aa31ffdf26

### Example Request

    POST /my/machines/75cfe125-a5ce-49e8-82ac-09aa31ffdf26 HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 12
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

    action=reboot

### Example Response

    HTTP/1.1 202 Accepted
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Server: SmartDataCenter
    Connection: close
    Date: Wed, 13 Apr 2011 23:35:25 GMT
    X-Api-Version: 7.0.0
    X-RequestId: F09F3674-2151-434B-9911-29DD188057F0
    X-Response-Time: 115
    Content-Length: 0


## ResizeMachine (POST /:login/machines/:id?action=resize)

Resize a machine to a new [package](#packages) (a.k.a. instance type).

**Note:** Resizing is only supported for SmartMachines (machines with
`type=smartmachine`, also known as 'zones').  KVM virtual machines
(`type=virtualmachine`) cannot be resized.

### Inputs

||action||String||Use the exact string "resize"||
||package||String||A package id, as returned from [ListPackages](#ListPackages)||

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||
||InvalidState||The machine is in the wrong state to be resized||
||InvalidArgument||If `action` was invalid, or `package` wasn't a valid id or name||
||MissingParameter||If `action` or `package` wasn't provided||

### CLI Command

    $ sdc-resizemachine --package=4dad8aa6-2c7c-e20a-be26-c7f4f1925a9a 75cfe125-a5ce-49e8-82ac-09aa31ffdf26

### Example Request

    POST /my/machines/75cfe125-a5ce-49e8-82ac-09aa31ffdf26 HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 12
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

    action=resize&package=4dad8aa6-2c7c-e20a-be26-c7f4f1925a9a

### Example Response

    HTTP/1.1 202 Accepted
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Connection: close
    x-api-version: 7.0.0
    Date: Sat, 11 Jun 2011 18:31:14 GMT
    Server: SmartDataCenter
    x-request-id: 3974ead1-0f1d-49ed-974c-1abfd13d6087
    x-response-time: 161
    Content-Length: 0


## RenameMachine (POST /:login/machines/:id?action=rename)

Allows you to rename a machine.  POST to the machine `id` with an action of
`rename`.  You must additionally include a new name for the machine.

### Inputs

||action||String||Use the exact string "rename"||
||name||String||The new "friendly" name for this machine||

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||
||InvalidState||The machine is in the wrong state to be stopped||
||InvalidArgument||If `action` was invalid, or `name` wasn't a valid name||
||MissingParameter||If `action` or `name` wasn't provided||

### CLI Command

    $ sdc-renamemachine --name=new_friendly_name 75cfe125-a5ce-49e8-82ac-09aa31ffdf26

### Example Request

    POST /my/machines/75cfe125-a5ce-49e8-82ac-09aa31ffdf26 HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 12
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

    action=rename&name=new_friendly_name

### Example Response

    HTTP/1.1 202 Accepted
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Connection: close
    x-api-version: 7.0.0
    Date: Sat, 11 Jun 2011 18:31:14 GMT
    Server: SmartDataCenter
    x-request-id: 3974ead1-0f1d-49ed-974c-1abfd13d6087
    x-response-time: 161
    Content-Length: 0


## EnableMachineFirewall (POST /:login/machines/:id?action=enable_firewall)

Allows you to enable firewall for a machine.

### Inputs

||action||String||Use the exact string "enable_firewall"||

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||
||InvalidState||The machine is the wrong state to enable firewall||
||InvalidArgument||If `action` was invalid||
||MissingParameter||If `action` wasn't provided||

### CLI Command

    $ sdc-enablemachinefirewall 75cfe125-a5ce-49e8-82ac-09aa31ffdf26

### Example Request

    POST /my/machines/75cfe125-a5ce-49e8-82ac-09aa31ffdf26 HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 12
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

    action=enable_firewall

### Example Response

    HTTP/1.1 202 Accepted
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Connection: close
    x-api-version: 7.0.0
    Date: Sat, 11 Jun 2011 18:31:14 GMT
    Server: SmartDataCenter
    x-request-id: 3974ead1-0f1d-49ed-974c-1abfd13d6087
    x-response-time: 161
    Content-Length: 0

## DisableMachineFirewall (POST /:login/machines/:id?action=disable_firewall)

Allows you to completely disable firewall for a machine.

### Inputs

||action||String||Use the exact string "disable_firewall"||

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||
||InvalidState||The machine is the wrong state to disable firewall||
||InvalidArgument||If `action` was invalid||
||MissingParameter||If `action` wasn't provided||

### CLI Command

    $ sdc-disablemachinefirewall 75cfe125-a5ce-49e8-82ac-09aa31ffdf26

### Example Request

    POST /my/machines/75cfe125-a5ce-49e8-82ac-09aa31ffdf26 HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 12
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

    action=disable_firewall

### Example Response

    HTTP/1.1 202 Accepted
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Connection: close
    x-api-version: 7.0.0
    Date: Sat, 11 Jun 2011 18:31:14 GMT
    Server: SmartDataCenter
    x-request-id: 3974ead1-0f1d-49ed-974c-1abfd13d6087
    x-response-time: 161
    Content-Length: 0


## CreateMachineSnapshot (POST /:login/machines/:id/snapshots)

Allows you to take a snapshot of a machine.  Once you have one or more
snapshots, you can boot the machine from a previous snapshot.

Snapshots are not usable with other machines; they are a point in time snapshot
of the current machine. Snapshots can also only be taken of  machines that are
of type 'smartmachine'.

Since SmartMachines use a copy-on-write filesystem, snapshots take up increasing
amounts of space as the filesystem changes over time. There is a limit to how
much space snapshots are allowed to take. Plan your snapshots accordingly.

You can poll on [GetMachineSnapshot](#GetMachineSnapshot) until the `state` is
`success`.

### Inputs

||name||String||The name to assign to the new snapshot||

### Returns

||name||String||The name of this snapshot||
||state||String||The current state of the snapshot||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||
||InvalidArgument||If `name` was invalid||

### CLI Command

    $ sdc-createmachinesnapshot --name=just-booted 5e42cd1e-34bb-402f-8796-bf5a2cae47db

### Example Request

    POST /my/machines/5e42cd1e-34bb-402f-8796-bf5a2cae47db/snapshots HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 12
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

    name=just-booted

### Example Response

    HTTP/1.1 201 Created
    Location: /mark/machines/5e42cd1e-34bb-402f-8796-bf5a2cae47db/snapshots/just-booted
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:19:26 GMT
    Server: SmartDataCenter
    X-Request-Id: 4bcf467e-4b88-4ab4-b7ab-65fad7464de9
    X-Response-Time: 754
    Content-Type: application/json
    Content-MD5: qKVbfrhXVqh7Oni6Pub9Pw==
    Content-Length: 116

    {
      "name": "just-booted",
      "state": "queued",
      "created": "2011-07-05T17:19:26+00:00",
      "updated": "2011-07-05T17:19:26+00:00"
    }


## StartMachineFromSnapshot (POST /:login/machines/:id/snapshots/:name)

If a machine is in the 'stopped' state, you can choose to start the machine from
the referenced snapshot. This is effectively a means to roll back machine state.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login`, `:id` or `:name` does not exist||

### CLI Command

    $ sdc-startmachinefromsnapshot --snapshot=just-booted 5e42cd1e-34bb-402f-8796-bf5a2cae47db

### Example Request

    POST /my/machines/5e42cd1e-34bb-402f-8796-bf5a2cae47db/snapshots/just-booted HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 0
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 202 Accepted
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:26:56 GMT
    Server: SmartDataCenter
    X-Request-Id: af79d9cd-68c5-4002-95c6-af4c3ff0f1e4
    X-Response-Time: 297
    Content-Length: 0


## ListMachineSnapshots (GET /:login/machines/:id/snapshots)

Lists all snapshots taken for a given machine.  There are no filtration
parameters for this API.

### Inputs

* None

### Returns

An array of snapshots:

||name||String||The name of this snapshot||
||state||String||The current state of the snapshot||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI Command

    $ sdc-listmachinesnapshots 5e42cd1e-34bb-402f-8796-bf5a2cae47db

### Example Request

    GET /my/machines/5e42cd1e-34bb-402f-8796-bf5a2cae47db/snapshots HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 0
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 Ok
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:19:26 GMT
    Server: SmartDataCenter
    X-Request-Id: 06a57272-9238-4276-951b-4123fbfdb948
    X-Response-Time: 66
    Content-Type: application/json
    Content-MD5: UYdtqgRjRZVikfCM5Uf4XQ==
    Content-Length: 119

    [
      {
        "name": "just-booted",
        "state": "queued",
        "created": "2011-07-05T17:19:26+00:00",
        "updated": "2011-07-05T17:19:26+00:00"
      }
    ]


## GetMachineSnapshot (GET /:login/machines/:id/snapshots/:name)

Gets the state of the named snapshot.

### Inputs

* None

### Returns

||name||String||The name of this snapshot||
||state||String||The current state of the snapshot (poll until it's "created")||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login`, `:id` or `:name` does not exist||

### CLI Command

    $ sdc-getmachinesnapshot --snapshot=just-booted 5e42cd1e-34bb-402f-8796-bf5a2cae47db

### Example Request

    GET /my/machines/5e42cd1e-34bb-402f-8796-bf5a2cae47db/snapshots/just-booted HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 0
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 OK
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:26:56 GMT
    Server: SmartDataCenter
    X-Request-Id: af79d9cd-68c5-4002-95c6-af4c3ff0f1e4
    X-Response-Time: 297
    Content-Type: application/json
    Content-MD5: VoPeS9cac4YMBIs8gUkd/A==
    Content-Length: 117

    {
      "name": "just-booted",
      "state": "queued",
      "created": "2011-07-05T17:19:26+00:00",
      "updated": "2011-07-05T17:19:26+00:00"
    }


## DeleteMachineSnapshot (DELETE /:login/machines/:id/snapshots/:name)

Deletes the specified snapshot of a machine.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login`, `:id` or `:name` does not exist||

### CLI Command

    $ sdc-deletemachinesnapshot --snapshot=just-booted 5e42cd1e-34bb-402f-8796-bf5a2cae47db

### Example Request

    DELETE /my/machines/5e42cd1e-34bb-402f-8796-bf5a2cae47db/snapshots/just-booted HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 0
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 204 No Content
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:26:56 GMT
    Server: SmartDataCenter
    X-Request-Id: af79d9cd-68c5-4002-95c6-af4c3ff0f1e4
    X-Response-Time: 297
    Content-Length: 0


## UpdateMachineMetadata (POST /:login/machines/:id/metadata)

Allows you to update the metadata for a given machine.  Note that updating the
metadata via CloudAPI will result in the metadata being updated in the running
instance.

The semantics of this call are subtly different that the AddMachineTags call --
any metadata keys passed in here are created if they do not exist, and
overwritten if they do.

### Inputs

||**Field**||**Type**||**Description**||
||$key||String||You can assign any number of metadata keys in this call; the string can be either a plain string, or a JSON-encoded object||

### Returns

Returns the current set of tags.

||**Field**||**Type**||**Description**||
||$key||Object||Your value(s)||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI Command

    $ ./sdc-updatemachinemetadata -m foo=bar -m group=test cf055959-d776-482e-bd71-ca510a04bdd7

### Example Request

    POST /my/machines/cf055959-d776-482e-bd71-ca510a04bdd7/metadata HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 12
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

    foo=bar&group=test

### Example Response

    HTTP/1.1 200 Ok
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:19:26 GMT
    Server: SmartDataCenter
    X-Request-Id: 4bcf467e-4b88-4ab4-b7ab-65fad7464de9
    X-Response-Time: 754
    Content-Type: application/json
    Content-MD5: qKVbfrhXVqh7Oni6Pub9Pw==
    Content-Length: 116

    {
      "foo": "bar",
      "group": "test"
    }


## ListMachineMetadata (GET /:login/machines/:id/metadata)

Returns the complete set of metadata associated with this machine.

### Inputs

||**Field**||**Type**||**Description**||
||credentials||Boolean||Whether or not to return machine credentials. Defaults to false.||

### Returns

Returns the current metadata object

||**Field**||**Type**||**Description**||
||$name||Object||Your metadata||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI Command

    $ sdc-listmachinemetadata cf055959-d776-482e-bd71-ca510a04bdd7

### Example Request

    GET /my/machines/cf055959-d776-482e-bd71-ca510a04bdd7/metadata?credentials=true HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 Ok
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:19:26 GMT
    Server: SmartDataCenter
    X-Request-Id: 4bcf467e-4b88-4ab4-b7ab-65fad7464de9
    X-Response-Time: 754
    Content-Type: application/json
    Content-MD5: qKVbfrhXVqh7Oni6Pub9Pw==
    Content-Length: 116

    {
      "foo": "bar",
      "group": "test",
      "credentials": {
        "root": "s8v9kuht5e",
        "admin": "mf4bteqhpy"
      }
    }


## GetMachineMetadata (GET /:login/machines/:id/metadata/:key)

Returns a single metadata entry associated with this machine.

### Inputs

||**Field**||**Type**||**Description**||
||key||String||Name of metadata value to retrieve.||

### Returns

Returns metadata value as string.

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login`, `:id` or `:key` does not exist||

### CLI Command

    $ sdc-getmachinemetadata --metadataId=foo cf055959-d776-482e-bd71-ca510a04bdd7

### Example Request

    GET /my/machines/cf055959-d776-482e-bd71-ca510a04bdd7/metadata/foo HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 Ok
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Connection: close
    X-Api-Version: 7.2.0
    Date: Tue, 05 Jul 2014 17:19:26 GMT
    Server: SmartDataCenter
    X-Request-Id: 4bcf467e-4b88-4ab4-b7ab-65fad7464de9
    X-Response-Time: 754
    Content-Type: application/json
    Content-MD5: qKVbfrhXVqh7Oni6Pub9Pw==
    Content-Length: 4

    bar


## DeleteMachineMetadata (DELETE /:login/machines/:id/metadata/:key)

Deletes a single metadata key from this machine.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login`, `:id` or `:key` does not exist||

### CLI Command

    $ sdc-deletemachinemetadata --metadata=foo cf055959-d776-482e-bd71-ca510a04bdd7

### Example Request

    DELETE /my/machines/cf055959-d776-482e-bd71-ca510a04bdd7/metadata/foo HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 204 No Content
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:19:26 GMT
    Server: SmartDataCenter
    X-Request-Id: 4bcf467e-4b88-4ab4-b7ab-65fad7464de9
    X-Response-Time: 754
    Content-Type: application/json
    Content-MD5: qKVbfrhXVqh7Oni6Pub9Pw==
    Content-Length: 0

## DeleteAllMachineMetadata (DELETE /:login/machines/:id/metadata)

Deletes all metadata keys from this machine.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI Command

    $ sdc-deletemachinemetadata --metadata='*' cf055959-d776-482e-bd71-ca510a04bdd7

If you're running in a Unix-like environment, you may need to quote the wildcard
to keep the shell from matching files in the current directory.

### Example Request

    DELETE /my/machines/cf055959-d776-482e-bd71-ca510a04bdd7/metadata HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 204 No Content
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:19:26 GMT
    Server: SmartDataCenter
    X-Request-Id: 4bcf467e-4b88-4ab4-b7ab-65fad7464de9
    X-Response-Time: 754
    Content-Type: application/json
    Content-MD5: qKVbfrhXVqh7Oni6Pub9Pw==
    Content-Length: 0


## AddMachineTags (POST /:login/machines/:id/tags)

Allows you to add additional tags, other than those set at provisioning time.
This API lets you *append* new tags, not overwrite existing tags.

This call allows you to send any number of parameters; all of these will be
converted into tags on the machine that can be used for searching later.

### Inputs

||**Field**||**Type**||**Description**||
||$tagName||String||You can assign any number of tags in this call||

### Returns

Returns the current set of tags.

||**Field**||**Type**||**Description**||
||$tagName||String||Your value||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI Command

    $ sdc-addmachinetags --tag='foo=bar' --tag='group=test' 5e42cd1e-34bb-402f-8796-bf5a2cae47db

### Example Request

    POST /my/machines/5e42cd1e-34bb-402f-8796-bf5a2cae47db/tags HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 12
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

    foo=bar&group=test

### Example Response

    HTTP/1.1 200 Ok
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, PUT
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:19:26 GMT
    Server: SmartDataCenter
    X-Request-Id: 4bcf467e-4b88-4ab4-b7ab-65fad7464de9
    X-Response-Time: 754
    Content-Type: application/json
    Content-MD5: qKVbfrhXVqh7Oni6Pub9Pw==
    Content-Length: 116

    {
      "foo": "bar",
      "group": "test"
    }


## ReplaceMachineTags (PUT /:login/machines/:id/tags)

Allows you to replace all machine tags. This API lets you *overwrite* existing
tags, not append to existing tags.

This call allows you to send any number of parameters; all of these will be
converted into tags on the machine that can be used for searching later.

### Inputs

||**Field**||**Type**||**Description**||
||$tagName||String||You can assign any number of tags in this call||

### Returns

Returns the current set of tags.

||**Field**||**Type**||**Description**||
||$tagName||String||Your value||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI Command

    $ sdc-replacemachinetags --tag='foo=bar' --tag='group=test' 5e42cd1e-34bb-402f-8796-bf5a2cae47db

### Example Request

    PUT /my/machines/5e42cd1e-34bb-402f-8796-bf5a2cae47db/tags HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Content-Length: 12
    Content-Type: application/x-www-form-urlencoded
    Api-Version: ~7.0

    foo=bar&group=test

### Example Response

    HTTP/1.1 200 Ok
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, PUT
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2012 17:19:26 GMT
    Server: SmartDataCenter
    X-Request-Id: 4bcf467e-4b88-4ab4-b7ab-65fad7464de9
    X-Response-Time: 754
    Content-Type: application/json
    Content-MD5: qKVbfrhXVqh7Oni6Pub9Pw==
    Content-Length: 116

    {
      "foo": "bar",
      "group": "test"
    }


## ListMachineTags (GET /:login/machines/:id/tags)

Returns the complete set of tags associated with this machine.

### Inputs

* None

### Returns

Returns the current set of tags.

||**Field**||**Type**||**Description**||
||$tagName||String||Your value||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI Command

    $ sdc-listmachinetags 5e42cd1e-34bb-402f-8796-bf5a2cae47db

### Example Request

    GET /my/machines/5e42cd1e-34bb-402f-8796-bf5a2cae47db/tags HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 Ok
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, PUT
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:19:26 GMT
    Server: SmartDataCenter
    X-Request-Id: 4bcf467e-4b88-4ab4-b7ab-65fad7464de9
    X-Response-Time: 754
    Content-Type: application/json
    Content-MD5: qKVbfrhXVqh7Oni6Pub9Pw==
    Content-Length: 116

    {
      "foo": "bar",
      "group": "test"
    }


## GetMachineTag (GET /:login/machines/:id/tags/:tag)

Returns the value for a single tag on this machine.

Note that this API is "special", as it returns content in `text/plain`; this
also means you must set the `Accept` header to `text/plain`.

### Inputs

* None

### Returns

Returns the value of `:tag` in plain text.

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login`, `:id` or `:tag` does not exist||

### CLI Command

    $ sdc-getmachinetag --tag=foo 5e42cd1e-34bb-402f-8796-bf5a2cae47db

### Example Request

    GET /my/machines/5e42cd1e-34bb-402f-8796-bf5a2cae47db/tags/foo HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: text/plain
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 Ok
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:19:26 GMT
    Server: SmartDataCenter
    X-Request-Id: 4bcf467e-4b88-4ab4-b7ab-65fad7464de9
    X-Response-Time: 754
    Content-Type: text/plain
    Content-MD5: qKVbfrhXVqh7Oni6Pub9Pw==
    Content-Length: 3

    bar


## DeleteMachineTag (DELETE /:login/machines/:id/tags/:tag)

Deletes a single tag from this machine.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login`, `:id` or `:tag` does not exist||

### CLI Command

    $ sdc-deletemachinetag --tag=foo 5e42cd1e-34bb-402f-8796-bf5a2cae47db

### Example Request

    DELETE /my/machines/5e42cd1e-34bb-402f-8796-bf5a2cae47db/tags/foo HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: text/plain
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 204 No Content
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:19:26 GMT
    Server: SmartDataCenter
    X-Request-Id: 4bcf467e-4b88-4ab4-b7ab-65fad7464de9
    X-Response-Time: 754
    Content-Length: 0


## DeleteMachineTags (DELETE /:login/machines/:id/tags)

Deletes all tags from a machine.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI Command

    $ sdc-deletemachinetag --tag='*'' 5e42cd1e-34bb-402f-8796-bf5a2cae47db

If you're running in a Unix-like environment, you may need to quote the wildcard
to keep the shell from matching files in the current directory.

### Example Request

    DELETE /my/machines/5e42cd1e-34bb-402f-8796-bf5a2cae47db/tags HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: text/plain
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 204 No Content
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Connection: close
    X-Api-Version: 7.0.0
    Date: Tue, 05 Jul 2011 17:19:26 GMT
    Server: SmartDataCenter
    X-Request-Id: 4bcf467e-4b88-4ab4-b7ab-65fad7464de9
    X-Response-Time: 754
    Content-Length: 0


## DeleteMachine (DELETE /:login/machines/:id)

Allows you to completely destroy a machine.  Machine must be in the `stopped`
state first.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||
||InvalidState||The machine is the wrong state to be deleted||

### CLI Command

    $ sdc-deletemachine 75cfe125-a5ce-49e8-82ac-09aa31ffdf26

### Example Request

    DELETE /my/machines/75cfe125-a5ce-49e8-82ac-09aa31ffdf26 HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

#### Example Response

    HTTP/1.1 204 No Content
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST, DELETE
    Server: SmartDataCenter
    Connection: close
    Date: Wed, 13 Apr 2011 23:38:03 GMT
    X-Api-Version: 7.0.0
    X-RequestId: 762C3F37-8ACA-4A49-AF10-84CEC8137B1D
    X-Response-Time: 72
    Content-Length: 0


## MachineAudit (GET /:login/machines/:id/audit)

Provides a list of machine's accomplished actions. Results are sorted from
newest to oldest action.

### Inputs

* None

### Returns

* An array of action objects, which contain:

||action||String||The name of the action||
||parameters||Object||The original set of parameters sent when the action was requested||
||time||Date (ISO8601)||When the action finished||
||success||String||Either "yes" or "no", depending on the action's success||
||caller||Object||Account requesting the action||

Depending on the account requesting the action, `caller` can have the following
members:

||type||String||Authentication type for the action request. One of "basic", "operator", "signature" or "token"||
||user||String||When the authentication type is "basic", this member will be present and include user login||
||ip||String||The IP addresses this from which the action was requested. Not present if type is "operator"||
||keyId||String||When authentication type is either "signature" or "token", SSH key identifier||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI Command

    $ sdc-getmachineaudit 75cfe125-a5ce-49e8-82ac-09aa31ffdf26

### Example Request

    GET /my/machines/75cfe125-a5ce-49e8-82ac-09aa31ffdf26/audit HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

#### Example Response

    HTTP/1.1 200 OK
    content-type: application/json
    content-length: 191
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    connection: Keep-Alive
    content-md5: GRmOq/dAdKZJ4wVpEelRrQ==
    date: Fri, 22 Feb 2013 15:19:37 GMT
    server: Joyent SmartDataCenter 7.0.0
    api-version: 7.0.0
    request-id: 453aee00-7d03-11e2-8048-5195b6159808
    response-time: 34
    x-request-id: 453aee00-7d03-11e2-8048-5195b6159808
    x-api-version: 7.0.0
    x-response-time: 34

    [{
        "success": "yes",
        "time": "2013-02-22T15:19:32.522Z",
        "action": "provision",
        "caller": {
          "type": "signature",
          "ip": "127.0.0.1",
          "keyId": "/:login/keys/:fingerprint"
        }
      }, ...]




# Analytics

It is strongly recommended that before you read the API documentation for
Analytics, you first read through
[Appendix B: Cloud Analytics](#appendix-b-cloud-analytics). Most supporting
documentation and explanation of types and interactions are described there.


## DescribeAnalytics (GET /:login/analytics)

Supports retrieving the "schema" for instrumentations which can be created using
the analytics endpoint.

### Inputs

* None

### Returns

A large object that reflects the analytics available to you.

Each of the items listed below is an object; the keys in each are what can be
used. For example, in 'modules', you'll get something like:

    {
      "modules": {
        "cpu": { "label": "CPU" },
        "memory": { "label": "Memory" },
        ...
      },
      "fields": {
        "hostname": {
          "label": "server hostname",
          "type": "string"
        },
        "runtime": {
          "label": "time on CPU",
          "type": "time"
        },
        "zonename": {
          "label": "zone name",
          "type": "string"
        }
      },
      "types": {
        "string": {
          "arity": "discrete",
          "unit": ""
        },
        "size": {
          "arity": "numeric",
          "unit": "bytes",
          "abbr": "B",
          "base": 2,
        },
        "time": {
          "arity": "numeric",
          "unit": "seconds",
          "abbr": "s",
          "base": 10,
          "power": -9,
        }
      },
      "metrics": [ {
        "module": "cpu",
        "stat": "thread_executions",
        "label": "thread executions",
        "interval": "interval",
        "fields": [ "hostname", "zonename", "runtime" ],
        "unit": "operations"
      }, {
        "module": "memory",
        "stat": "rss",
        "label": "resident set size",
        "interval": "point",
        "fields": [ "hostname", "zonename" ],
        "type": "size"
      } ],
      "transformations": {
        "geolocate": {
          "label": "geolocate IP addresses",
          "fields": [ "raddr" ]
        },
        "reversedns": {
          "label": "reverse dns IP addresses lookup",
          "fields": [ "raddr" ]
        }
      }
    }

You can use `cpu`, `memory` as module parameters to the other APIs.

||**Field**||**Type**||
||modules||Object||
||fields||Object||
||types||Object||
||metrics||Object||
||transformations||Object||

Each of these objects is discussed below:

#### Modules

Each metric is identified by both a `module` and `stat` name.  Modules exist
as namespaces to organize metrics.  A module configuration looks like this:

    "modules": {
      "cpu": {
        "label": "CPU" },
        "memory": { "label": "Memory" },
        ...
      }

Each module has a name (its key in the "modules" structure), and an object with
a single field called `label`, which is its human-readable label.

#### Metrics

Metrics describe quantities which can be measured by the system.  Data is not
collected for metrics unless an instrumentation has been configured for it.

    "metrics": [ {
      "module": "cpu",
      "stat": "thread_executions",
      "label": "thread executions",
      "interval": "interval",
      "fields": [ "hostname", "zonename", "runtime" ],
      "unit": "operations"
    }, {
      "module": "memory",
      "stat": "rss",
      "label": "resident set size",
      "interval": "point",
      "fields": [ "hostname", "zonename" ],
      "type": "size"
    } ]

Each metric has the following properties:

||**Field**||**Type**||**Description**||
||module||String||With stat, a unique metric identifier||
||stat||String||With module, a unique metric identifier||
||label||String||A human-readable metric description||
||interval||String||either "interval" or "point", indicating whether the value of this metric covers activity over an *interval* of time or a snapshot of state at a particular *point* in time||
||fields||Array||a list of fields to be used for predicates and decompositions||
||type||String||type or unit used to display labels for values of this metric||

#### Fields

Fields represent metadata by which data points can be filtered or decomposed.

    "fields": {
      "pid": {
        "label": "process identifier",
        "type": "string"
      },
      "execname": {
        "label": "application name",
        "type": "string"
      },
      "psargs": {
        "label": "process arguments",
        "type": "string"
      },
      ...

Each field has the following properties:

||**Field**||**Type**||**Description**||
||label||String||human-readable description of the field||
||type||String||type of the field, which determines how to label it, as well as whether the field is numeric or discrete||

Fields are either numeric or discrete based on the "arity" of their type.

###### Numeric fields

* In predicates, values of numeric fields can be compared using numeric equality
  and inequality operators (=, <, >, etc).
* In decompositions, a numeric field yields a numeric decomposition (see
  "Numeric decompositions" above).

###### Discrete fields

* In predicates, values of discrete fields can only be compared using string
  equality.
* In decompositions, a discrete field yields a discrete decomposition (see
  "Discrete decompositions" above).

Note that some fields look like numbers but are used by software as identifiers,
and so are actually discrete fields.  Examples include process identifiers,
which are numbers, but don't generally make sense comparing using inequalities
or decomposing to get a numeric distribution.

#### Types

Types are used with both metrics and fields for two purposes: to hint to clients
at how to best label values, and to distinguish between numeric and discrete
quantities.

    "types": {
      "string": {
        "arity": "discrete",
        "unit": ""
      },
      "size": {
        "arity": "numeric",
        "unit": "bytes",
        "abbr": "B",
        "base": 2,
      },
      "time": {
        "arity": "numeric",
        "unit": "seconds",
        "abbr": "s",
        "base": 10,
        "power": -9,
       }
     }

Each type has the following properties:

||**Field**||**Type**||**Description**||
||arity||String||indicates whether values of this type are "discrete" (e.g. identifiers and other strings), or "numeric" (e.g. measurements)||
||unit||String||base unit for this type||
||abbr||String||(optional) abbreviation for this base unit for this type||
||base||Number||indicates that when labeled, this quantity is usually labeled with SI prefixes corresponding to powers of the specified base||
||power||Number||this indicates that the raw values of this type are expressed in units corresponding to base raised to power||

#### Transformations

Transformations are post-processing functions that can be applied to data when
it's retrieved.

    "transformations": {
      "geolocate": {
        "label": "geolocate IP addresses",
        "fields": [ "raddr" ]
      },
      "reversedns": {
        "label": "reverse dns IP addresses lookup",
        "fields": [ "raddr" ]
      }
    }

Each transformation has the following properties:

||**Field**||**Type**||**Description**||
||label||String||Human-readable string||
||fields||Array||List of field names that can be transformed||

The above transformations transform values of the "raddr" (remote address) field
of any metric to either an object with geolocation details, or an array of
reverse-DNS hostnames, respectively.

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` does not exist||

### CLI Command

    $ sdc-describeanalytics

### Example Request

    GET /my/analytics HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 OK
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Server: SmartDataCenter
    Connection: close
    Date: Wed, 13 Apr 2011 23:40:30 GMT
    X-Api-Version: 7.0.0
    X-RequestId: 83BB32FC-1F65-4FEB-871E-BABCD96D588D
    X-Response-Time: 285
    Content-Type: application/json
    Content-Length: 2806
    Content-MD5: M4mXJlxSgflBnhXPYYCp1g==

    {
      "modules": {
        "cpu": {
          "label": "CPU"
        },
        "fs": {
          "label": "Filesystem"
        },
        "node": {
          "label": "Node.js 0.4.x"
        }
      },
      // ....
    }


## ListInstrumentations (GET /:login/analytics/instrumentations)

Retrieves all currently created instrumentations.

### Inputs

* None

### Returns

An array of instrumentations:

||**Field**||**Type**||
||module||String||
||stat||String||
||predicate||String||
||decomposition||Array||
||value-dimension||Number||
||value-arity||String||
||retention-time||Number||
||granularity||Number||
||idle-max||Number||
||transformations||Array||
||persist-data||Boolean||
||crtime||Number||
||value-scope||String||
||id||String||
||uris||Array||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` does not exist||

### CLI

    $ sdc-listinstrumentations

### Example Request

    GET /my/analytics/instrumentations HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 OK
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Server: SmartDataCenter
    Connection: close
    Date: Wed, 13 Apr 2011 23:49:40 GMT
    X-Api-Version: 7.0.0
    X-RequestId: 99839114-1B59-4733-AC64-A93144CA7D8B
    X-Response-Time: 48
    Content-Type: application/json
    Content-Length: 1062
    Content-MD5: 8dSboZrGVMsaRYWGFbq88A==

    [
      {
        "module": "syscall",
        "stat": "syscalls",
        "predicate": {},
        "decomposition": [],
        "value-dimension": 1,
        "value-arity": "scalar",
        "enabled": true,
        "retention-time": 600,
        "idle-max": 3600,
        "transformations": {},
        "nsources": 1,
        "granularity": 1,
        "persist-data": false,
        "crtime": 1309457451143,
        "value-scope": "interval",
        "id": "42",
        "uris": [{
          "uri": "/admin/analytics/instrumentations/42/value/raw",
          "name": "value_raw"
        }]
      }
    }


## GetInstrumentation (GET /:login/analytics/instrumentations/:id)

Retrieves the configuration for an instrumentation.

### Inputs

* None

### Returns

||**Field**||**Type**||
||module||String||
||stat||String||
||predicate||String||
||decomposition||Array||
||value-dimension||Number||
||value-arity||String||
||retention-time||Number||
||granularity||Number||
||idle-max||Number||
||transformations||Array||
||persist-data||Boolean||
||crtime||Number||
||value-scope||String||
||id||String||
||uris||Array||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI

    $ sdc-getinstrumentation 1

### Example Request

    GET /my/analytics/instrumentations/1 HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 OK
    Location: /my/analytics/instrumentations/1
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, DELETE
    Server: SmartDataCenter
    Connection: close
    Date: Wed, 13 Apr 2011 23:53:29 GMT
    X-Api-Version: 7.0.0
    X-RequestId: E79B48A2-EC5B-475E-A473-1AF0053FCF4F
    X-Response-Time: 60
    Content-Type: application/json
    Content-Length: 530
    Content-MD5: kOuwnsK6U9yQY7MpN3lEvQ==

    {
      "module": "syscall",
      "stat": "syscalls",
      "predicate": {},
      "decomposition": [],
      "value-dimension": 1,
      "value-arity": "scalar",
      "enabled": true,
      "retention-time": 600,
      "idle-max": 3600,
      "transformations": {},
      "nsources": 1,
      "granularity": 1,
      "persist-data": false,
      "crtime": 1309374801692,
      "value-scope": "interval",
      "id": "2",
      "uris": [
        {
          "uri": "/my/analytics/instrumentations/2/value/raw",
          "name": "value_raw"
        }
      ]
    }


## GetInstrumentationValue (GET /:login/analytics/instrumentations/:id/value/raw)

Retrieves the data associated with an instrumentation for point(s) in time.

### Inputs

* None

### Returns

||**Field**||**Type**||
||value||Object||
||transformations||Object||
||start_time||Number||
||duration||Number||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI

    $ sdc-getinstrumentation --value 1

### Example Request

    GET /my/analytics/instrumentations/1/value/raw
    Host: api.example.com
    Authorization: ...
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 OK
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, DELETE
    Server: SmartDataCenter
    Connection: close
    Date: Wed, 13 Apr 2011 23:53:29 GMT
    X-Api-Version: 7.0.0
    X-RequestId: E79B48A2-EC5B-475E-A473-1AF0053FCF4F
    X-Response-Time: 60
    Content-Type: application/json
    Content-Length: 530
    Content-MD5: kOuwnsK6U9yQY7MpN3lEvQ==

    {
      "value": [
        [ [ 17000, 17999 ], 12 ],
        [ [ 18000, 18999 ], 12 ],
        ...
      ],
      "transformations": {},
      "start_time": 1309383598,
      "duration": 1,
      "nsources": 1,
      "minreporting": 1,
      "requested_start_time": 1309383598,
      "requested_duration": 1,
      "requested_end_time": 1309383599
    }


## GetInstrumentationHeatmap (GET /:login/analytics/instrumentations/:id/value/heatmap/image)

Retrieves metadata and a base64-encoded PNG image of a particular
instrumentation's heatmap.

### Inputs

||**Field**||**Type**||**Description**||
||height||Number||height of the image in pixels||
||width||Number||width of the image in pixels||
||ymin||Number||Y-Axis value for the bottom of the image (default: 0)||
||ymax||Number||Y-Axis value for the top of the image (default: auto)||
||nbuckets||Number||Number of buckets in the vertical dimension||
||selected||Array||Array of field values to highlight, isolate or exclude||
||isolate||Boolean||If true, only draw selected values||
||exclude||Boolean||If true, don't draw selected values at all||
||hues||Array||Array of colors for highlighting selected field values||
||decompose_all||Boolean||highlight all field values (possibly reusing hues)||

### Returns

||**Field**||**Type**||**Description**||
||bucket\_time||Number||time corresponding to the bucket (Unix seconds)||
||bucket\_ymin||Number||Minimum y-axis value for the bucket||
||bucket\_ymax||Number||Maximum y-axis value for the bucket||
||present||Object||if the instrumentation defines a discrete decomposition, this property's value is an object whose keys are values of that field and whose values are the number of data points in that bucket for that key||
||total||Number||The total number of data points in the bucket||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||
||InvalidArgument||If input values were incorrect||

### CLI

* None

### Example Request

    GET /my/analytics/instrumentations/1/heatmap/image HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

### Example Response

    HTTP/1.1 200 OK
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET
    Connection: close
    X-Api-Version: 7.0.0
    Date: Wed, 29 Jun 2011 23:57:44 GMT
    Server: SmartDataCenter
    X-Request-Id: 3d511185-36b8-4699-9cdd-a67bf8be7a6d
    X-Response-Time: 109
    Content-Type: application/json
    Content-MD5: r5tPNDLr1HQE1tsLNqPbvg==
    Content-Length: 2052

    {
      "nbuckets": 100,
      "width": 600,
      "height": 300,
      "ymin": 0,
      "ymax": 400000,
      "present": [],
      "transformations": {},
      "image": "iVBORw0KGgoAAA...",
      "start_time": 1309391804,
      "duration": 60,
      "nsources": 1,
      "minreporting": 1,
      "requested_start_time": 1309391804,
      "requested_duration": 60,
      "requested_end_time": 1309391864
      }


## GetInstrumentationHeatmapDetails (GET /:login/analytics/instrumentations/:id/value/heatmap/details)

Allows you to retrieve the bucket details for a heatmap.

### Inputs

Takes all the same parameters as
[GetInstrumentationHeatmap](#GetInstrumentationHeatmap), and additionally:

||**Field**||**Type**||
||x||Number||
||y||Number||

### Returns

The returned value includes:

||**Field**||**Type**||
||bucket\_time||Number||
||bucket\_ymin||Number||
||bucket\_ymax||Number||
||present||Object||
||total||Number||

### Errors

### CLI

* None

### Example Request

* TODO

### Example Response

* TODO


## CreateInstrumentation (POST /:login/analytics/instrumentations)

Creates an instrumentation.  Note you can clone an existing instrumentation
by passing in the parameter `clone`, which should be a numeric id of an
existing instrumentation.

### Inputs

||**Field**||**Type**||**Description**||
||clone||Number||An existing instrumentation to duplicate (optional)||
||module||String||The CA module||
||stat||String||The CA stat||
||predicate||String||Must be a JSON string||
||decomposition||String||An array of arrays||
||granularity||Number||Number of seconds between data points (default is 1)||
||retention-time||Number||How long to keep this instrumentation's data for||
||persist-data||Boolean||Whether or not to store this for historical analysis||
||idle-max||Number||Number of seconds after which, if the instrumentation or its data has not been accessed via the API, the service may delete the instrumentation and its data||

### Returns

||**Field**||**Type**||
||module||String||
||stat||String||
||predicate||String||
||decomposition||Array||
||value-dimension||Number||
||value-arity||String||
||retention-time||Number||
||granularity||Number||
||idle-max||Number||
||transformations||Array||
||persist-data||Boolean||
||crtime||Number||
||value-scope||String||
||id||String||
||uris||Array||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` does not exist||
||InvalidArgument||If input values were incorrect||
||MissingParameter||If parameter values were missing||

### CLI

    $ sdc-createinstrumentation --module=syscall --stat=syscalls

### Example Request

    POST /my/analytics/instrumentations HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0
    Content-Length: 12
    Content-Type: application/x-www-form-urlencoded

    module=syscall&stat=syscalls

### Example Response

    HTTP/1.1 201 Created
    Location: https://api.example.com/my/analytics/instrumentations/2
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, POST
    Server: SmartDataCenter
    Connection: close
    Date: Wed, 13 Apr 2011 23:43:24 GMT
    X-Api-Version: 7.0.0
    X-RequestId: F4238406-ED7D-4938-937B-4E3D0F93D924
    X-Response-Time: 1508
    Content-Type: application/json
    Content-Length: 544
    Content-MD5: CrcS3CTR5mwpOvJEx60s1g==

    {
      "module": "syscall",
      "stat": "syscalls",
      "predicate": {},
      "decomposition": [],
      "value-dimension": 1,
      "value-arity": "scalar",
      "enabled": true,
      "retention-time": 600,
      "idle-max": 3600,
      "transformations": {},
      "nsources": 1,
      "granularity": 1,
      "persist-data": false,
      "crtime": 1309374801692,
      "value-scope": "interval",
      "id": "2",
      "uris": [
        {
          "uri": "/mark/analytics/instrumentations/2/value/raw",
          "name": "value_raw"
        }
      ]
    }


## DeleteInstrumentation (DELETE /:login/analytics/instrumentations/:id)

Destroys an instrumentation.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI

    $ sdc-deleteinstrumentation 1

#### Example Request

    DELETE /my/analytics/instrumentations/1 HTTP/1.1
    Authorization: ...
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.0

#### Example Response

    HTTP/1.1 204 No Content
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, DELETE
    Server: SmartDataCenter
    Connection: close
    Date: Wed, 13 Apr 2011 23:56:29 GMT
    X-Api-Version: 7.0.0
    X-RequestId: E4DD448D-F491-4A88-9237-DAF6C4DC782C
    X-Response-Time: 49
    Content-Length: 0




# FirewallRules

You can manage Firewall Rules for your machines through CloudAPI.


## Firewall Rule Syntax

In general, the firewall rule is composed of the following pieces:

    FROM <target a> TO <target b> <action> <protocol> <port>

where `target` can be one of `wildcard`, `ip`, `subnet`, `tag` or `vm`, `action`
is either `ALLOW` or `BLOCK`, `protocol` will be one of `tcp`, `udp` and `icmp`,
and `port` is a valid port number.

The rule should have `tag` or `vm` in the FROM or TO target. The following are some possibilities:

### Allow incoming http traffic to a VM:

    {
        "enabled": true,
        "rule": "FROM any TO vm 0abeae82-c040-4080-ac60-b60d3e3890a7 ALLOW tcp port 80"
    }

### Block outgoing SMTP traffic from a VM to a subnet:

    {
        "enabled": true,
        "rule": "FROM vm 0abeae82-c040-4080-ac60-b60d3e3890a7 TO subnet 10.99.99.0/24 BLOCK tcp port 25"
    }

### Allow an IP HTTP and HTTPS access to all VMs tagged www or testwww:

    {
        "enabled": true,
        "rule": "FROM ip 10.99.99.7 TO (tag www OR tag testwww) ALLOW tcp (port 80 AND port 443)"
    }

### Allow syslog traffic from VMs tagged with group=web to VMs tagged with group=mon:

    {
        "enabled": true,
        "rule": "FROM tag group=www TO tag group=mon ALLOW udp port 514"
    }


## ListFirewallRules (GET /:login/fwrules)

List all firewall rules for the current account.

### Inputs

* None

### Returns

An array of firewall rule objects.  Firewall Rules are:

||**Field**||**Type**||**Description**||
||id||String||Unique identifier for this rule||
||enabled||Boolean||Indicates if the rule is enabled||
||rule||String||Firewall rule text||
||global||Boolean||Indicates if the rule is global (optional, since v7.1.1)||
||description||String||Human-readable description for the rule (optional, since v7.1.1)||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` does not exist||

### CLI

    $ sdc-listfirewallrules

#### Example Request

    GET /login/fwrules HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    accept-version: ~7.0
    host: api.example.com
    connection: keep-alive

#### Example Response

    HTTP/1.1 200 OK
    content-type: application/json
    content-length: 158
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    connection: Keep-Alive
    content-md5: v6s92rl/nTS2Ts5CNDcgQw==
    server: Joyent SmartDataCenter 7.0.0
    api-version: 7.0.0
    request-id: 35147710-7f49-11e2-8585-bd5fc323c72c
    response-time: 134
    x-request-id: 35147710-7f49-11e2-8585-bd5fc323c72c
    x-api-version: 7.0.0
    x-response-time: 134

    [
      {
        "id": "38de17c4-39e8-48c7-a168-0f58083de860",
        "rule": "FROM vm 3d51f2d5-46f2-4da5-bb04-3238f2f64768 TO subnet 10.99.99.0/24 BLOCK tcp PORT 25",
        "enabled": true
      }
    ]


## GetFirewallRule (GET /:login/fwrules/:id)

Retrieves an individual firewall rule.

### Inputs

* None

### Returns

||**Field**||**Type**||**Description**||
||id||String||Unique identifier for this rule||
||enabled||Boolean||Indicates if the rule is enabled||
||rule||String||Firewall rule text||
||global||Boolean||Indicates if the rule is global (optional, since v7.1.1)||
||description||String||Human-readable description for the rule (optional, since v7.1.1)||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` does not exist||

### CLI

    $ sdc-getfirewallrule 38de17c4-39e8-48c7-a168-0f58083de860

#### Example Request

    GET /login/fwrules/38de17c4-39e8-48c7-a168-0f58083de860 HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    accept-version: ~7.0
    host: api.example.com

#### Example Response

    HTTP/1.1 200 OK
    content-type: application/json
    content-length: 156
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    server: Joyent SmartDataCenter 7.0.0
    api-version: 7.0.0
    request-id: cf1c1340-7f49-11e2-8585-bd5fc323c72c
    response-time: 203
    x-request-id: cf1c1340-7f49-11e2-8585-bd5fc323c72c
    x-api-version: 7.0.0
    x-response-time: 203

    {
      "id": "38de17c4-39e8-48c7-a168-0f58083de860",
      "rule": "FROM vm 3d51f2d5-46f2-4da5-bb04-3238f2f64768 TO subnet 10.99.99.0/24 BLOCK tcp PORT 25",
      "enabled": true
    }


## CreateFirewallRule (POST /:login/fwrules)

Adds a new firewall rule for the specified account.  This rule will be added to
all the account's machines where it may be necessary.

### Inputs

||**Field**||**Type**||**Description**||
||enabled||Boolean||Indicates if the rule is enabled (optional, false by default)||
||rule||String||Firewall rule text||
||description||String||Human-readable description for the rule (optional, since v7.1.1)||

### Returns

Firewall rule object.

||**Field**||**Type**||**Description**||
||id||String||Unique identifier for this rule||
||enabled||Boolean||Indicates if the rule is enabled||
||rule||String||Firewall rule text||
||global||Boolean||Indicates if the rule is global (optional, since v7.1.1)||
||description||String||Human-readable description for the rule (optional, since v7.1.1)||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||InvalidArgument||If rule is invalid||
||MissingParameter||If rule wasn't provided||
||ResourceNotFound||If `:login` does not exist||

### CLI

    $ sdc-createfirewallrule --rule='...' --enabled=true

#### Example Request

    POST /login/fwrules HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    content-type: application/json
    accept-version: ~7.0
    content-length: 112
    host: api.example.com

#### Example Response

    HTTP/1.1 201 Created
    content-type: application/json
    content-length: 156
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    server: Joyent SmartDataCenter 7.0.0
    api-version: 7.0.0
    request-id: 2c0a2a20-7f49-11e2-8585-bd5fc323c72c
    response-time: 36
    x-request-id: 2c0a2a20-7f49-11e2-8585-bd5fc323c72c
    x-api-version: 7.0.0
    x-response-time: 36

    {
      "id": "38de17c4-39e8-48c7-a168-0f58083de860",
      "rule": "FROM vm 3d51f2d5-46f2-4da5-bb04-3238f2f64768 TO subnet 10.99.99.0/24 BLOCK tcp PORT 25",
      "enabled": true
    }


## UpdateFirewallRule (POST /:login/fwrules/:id)

Updates the given rule record and -- depending on rule contents --
adds/removes/updates the rule on all the required machines.

### Inputs

||**Field**||**Type**||**Description**||
||rule||String||Firewall rule text||
||description||String||Human-readable description for the rule (optional, since v7.1.1)||

### Returns

Firewall rule object.

||**Field**||**Type**||**Description**||
||id||String||Unique identifier for this rule||
||enabled||Boolean||Indicates if the rule is enabled||
||rule||String||Firewall rule text||
||global||Boolean||Indicates if the rule is global (optional, since v7.1.1)||
||description||String||Human-readable description for the rule (optional, since v7.1.1)||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||InvalidArgument||If rule is invalid or you are trying to modify a global rule||
||MissingParameter||If rule wasn't present||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI

    $ sdc-updatefirewallrule --rule='...' 38de17c4-39e8-48c7-a168-0f58083de860

#### Example Request

    POST /login/fwrules/38de17c4-39e8-48c7-a168-0f58083de860 HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    content-type: application/json
    accept-version: ~7.0
    content-length: 111
    host: api.example.com

    ...

#### Example Response

    HTTP/1.1 200 OK
    content-type: application/json
    content-length: 170
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    server: Joyent SmartDataCenter 7.0.0
    api-version: 7.0.0
    request-id: 284907d0-7f67-11e2-8585-bd5fc323c72c
    response-time: 225
    x-request-id: 284907d0-7f67-11e2-8585-bd5fc323c72c
    x-api-version: 7.0.0
    x-response-time: 225

    {
      "id": "38de17c4-39e8-48c7-a168-0f58083de860",
      "rule": "FROM vm 3d51f2d5-46f2-4da5-bb04-3238f2f64768 TO subnet 10.99.99.0/24 BLOCK tcp (PORT 25 AND PORT 80)",
      "enabled": true
    }


## EnableFirewallRule (POST /:login/fwrules/:id/enable)

Enables the given firewall rule if it is disabled.

### Inputs

* None

### Returns

Firewall rule

||**Field**||**Type**||**Description**||
||id||String||Unique identifier for this rule||
||enabled||Boolean||Indicates if the rule is enabled||
||rule||String||Firewall rule text||
||global||Boolean||Indicates if the rule is global (optional, since v7.1.1)||
||description||String||Human-readable description for the rule (optional, since v7.1.1)||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI

    $ sdc-enablefirewallrule 38de17c4-39e8-48c7-a168-0f58083de860

#### Example Request

    POST /login/fwrules/38de17c4-39e8-48c7-a168-0f58083de860/enable HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    content-type: application/json
    accept-version: ~7.0
    content-length: 2
    host: api.example.com

#### Example Response

    HTTP/1.1 200 OK
    content-type: application/json
    content-length: 170
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    connection: Keep-Alive
    server: Joyent SmartDataCenter 7.0.0
    api-version: 7.0.0
    request-id: 1ebe23c0-7f68-11e2-8585-bd5fc323c72c
    response-time: 232
    x-request-id: 1ebe23c0-7f68-11e2-8585-bd5fc323c72c
    x-api-version: 7.0.0
    x-response-time: 232

    {
      "id": "38de17c4-39e8-48c7-a168-0f58083de860",
      "rule": "FROM vm 3d51f2d5-46f2-4da5-bb04-3238f2f64768 TO subnet 10.99.99.0/24 BLOCK tcp (PORT 25 AND PORT 80)",
      "enabled": true
    }


## DisableFirewallRule (POST /:login/fwrules/:id/disable)

Disables the given firewall rule if it is enabled.

### Inputs

* None

### Returns

Firewall rule

||**Field**||**Type**||**Description**||
||id||String||Unique identifier for this rule||
||enabled||Boolean||Indicates if the rule is enabled||
||rule||String||Firewall rule text||
||global||Boolean||Indicates if the rule is global (optional, since v7.1.1)||
||description||String||Human-readable description for the rule (optional, since v7.1.1)||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI

    $ sdc-disablefirewallrule 38de17c4-39e8-48c7-a168-0f58083de860

#### Example Request

    POST /login/fwrules/38de17c4-39e8-48c7-a168-0f58083de860/disable HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    content-type: application/json
    accept-version: ~7.0
    content-length: 2
    host: api.example.com

#### Example Response

    HTTP/1.1 200 OK
    content-type: application/json
    content-length: 171
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    content-md5: E7I47cYr/F7S4J68NbK1AQ==
    server: Joyent SmartDataCenter 7.0.0
    api-version: 7.0.0
    request-id: 8a2d7490-7f67-11e2-8585-bd5fc323c72c
    response-time: 234
    x-request-id: 8a2d7490-7f67-11e2-8585-bd5fc323c72c
    x-api-version: 7.0.0
    x-response-time: 234

    {
      "id": "38de17c4-39e8-48c7-a168-0f58083de860",
      "rule": "FROM vm 3d51f2d5-46f2-4da5-bb04-3238f2f64768 TO subnet 10.99.99.0/24 BLOCK tcp (PORT 25 AND PORT 80)",
      "enabled": false
    }


## DeleteFirewallRule (DELETE /:login/fwrules/:id)

Removes the given firewall rule from all the required machines.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI

    $ sdc-deletefirewallrule 38de17c4-39e8-48c7-a168-0f58083de860

#### Example Request

    DELETE /login/fwrules/38de17c4-39e8-48c7-a168-0f58083de860 HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    accept-version: ~7.0
    host: api.example.com

#### Example Response

    HTTP/1.1 204 No Content
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    connection: Keep-Alive
    server: Joyent SmartDataCenter 7.0.0
    api-version: 7.0.0
    request-id: 50a78b60-7f68-11e2-8585-bd5fc323c72c
    response-time: 219
    x-request-id: 50a78b60-7f68-11e2-8585-bd5fc323c72c
    x-api-version: 7.0.0
    x-response-time: 219


## ListMachineFirewallRules (GET /:login/machines/:machine/fwrules)

Exactly with the same input and output as
[List Firewall Rules](#ListFirewallRules), but just for the rules affecting the
given `:machine`.


## ListFirewallRuleMachines (GET /:login/fwrules/:id/machines)

Will return the collection of machines affected by the firewall rule given by
`:id`.  The output will be exactly the same as for
[List Machines](#ListMachines).




# Fabrics

CloudAPI provides a way to create and manipulate a fabric. On the fabric you can
create VLANs, and then under that create layer three networks.


## ListFabricVLANs (GET /:login/fabrics/default/vlans)

### Inputs

* None

### Returns

An array of VLAN objects that exist on the fabric. Each VLAN object has the
following properties:

||*Field*||*Type*||*Description*||
||vlan_id||Integer||A number from 0-4095 that indicates the VLAN's id||
||name||String||A unique name to identify the VLAN||
||description||String||An optional description of the VLAN||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If :login does not exist||

### CLI

    $ sdc-fabric vlan list

#### Example Request

    GET /login/fabrics/default/vlans HTTP/1.1
    Authorization: Basic ...
    Host: api.example.com
    Accept: application/json
    Accept-version: ~7.3

#### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Server: Joyent SmartDataCenter 7.3.0
    Api-Version: 7.3.0

    [
      {
        "name": "default",
        "vlan_id": 2
      }
    ]


## CreateFabricVLAN (POST /:login/fabrics/default/vlans)

Creates a new VLAN on the fabric.

### Inputs

||*Field*||*Type*||*Description*||
|| name || String || A unique name for this VLAN ||
|| vlan_id || Number || The VLAN identifier, must be in the range of 0-4095 ||
|| description || String || An optional description of the VLAN ||

### Returns

A VLAN Object.

||*Field*||*Type*||*Description*||
||vlan_id||Integer||A number from 0-4095 that indicates the VLAN's id||
||name||String||A unique name to identify the VLAN||
||description||String||An optional description of the VLAN||

### Errors

||**Error Code**||**Description**||
||ResourceNotFound||If :login does not exist||
||MissingParameter||If you didn't send a key||
||InvalidArgument||vlan_id or name are in use, or vlan_id is outside the valid range||

### CLI

    $ sdc-fabric vlan create

#### Example Request

    POST /login/fabrics/default/vlans HTTP/1.1
    Authorization: Basic ...
    Host: api.example.com
    Accept: application/json
    Accept-version: ~7.3

    {
      "name": "new",
      "description": "my description",
      "vlan_id": 100
    }

#### Example Response

    HTTP/1.1 201 Created
    Content-Type: application/json
    Server: Joyent SmartDataCenter 7.3.0
    Api-Version: 7.3.0

    {
      "name": "new",
      "description": "my description",
      "vlan_id": 100
    }


## GetFabricVLAN (GET /:login/fabrics/default/vlans/:vlan_id)

### Inputs

* None

### Returns

A VLAN Object.

||*Field*||*Type*||*Description*||
||vlan_id||Integer||A number from 0-4095 that indicates the VLAN's id||
||name||String||A unique name to identify the VLAN||
||description||String||An optional description of the VLAN||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:vlan_id` does not exist||

### CLI

    $ sdc-fabric vlan get

#### Example Request

    GET /login/fabrics/default/vlans/2 HTTP/1.1
    Authorization: Basic ...
    Host: api.example.com
    Accept: application/json
    Accept-version: ~7.3

#### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Server: Joyent SmartDataCenter 7.3.0
    Api-Version: 7.3.0

    {
      "name": "default",
      "vlan_id": 2
    }

## UpdateFabricVLAN (PUT /:login/fabrics/default/vlans/:vlan_id)

Updates a fabric VLAN.

### Inputs

All inputs are optional.

||*Field*||*Type*||*Description*||
|| name || String || A unique name for this VLAN ||
|| description || String || An optional description of the VLAN ||

### Returns

A VLAN Object.

||*Field*||*Type*||*Description*||
||vlan_id||Integer||A number from 0-4095 that indicates the VLAN's id||
||name||String||A unique name to identify the VLAN||
||description||String||An optional description of the VLAN||

### Errors

||**Error Code**||**Description**||
||ResourceNotFound||If :login or :vlan_id does not exist||

### CLI

    $ sdc-fabric vlan update 2 --description="new description"

#### Example Request

    POST /login/fabrics/default/vlans HTTP/1.1
    Authorization: Basic ...
    Host: api.example.com
    Accept: application/json
    Accept-version: ~7.3

    {
      "description": "new description"
    }

#### Example Response

    HTTP/1.1 202 Accepted
    Content-Type: application/json
    Server: Joyent SmartDataCenter 7.3.0
    Api-Version: 7.3.0

    {
      "name": "new",
      "description": "new description",
      "vlan_id": 100
    }


## DeleteFabricVLAN (DELETE /:login/fabrics/default/vlans/:vlan_id)

Deletes the specified VLAN. Note there must be no networks on that VLAN in order
for the VLAN to be deleted.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:vlan_id` does not exist||
||InUseError||The VLAN currently has active networks on it||

### CLI

    $ sdc-fabric vlan delete

#### Example Request

    DELETE /login/fabrics/default/vlans/2 HTTP/1.1
    Authorization: Basic ...
    Host: api.example.com
    Accept: application/json
    Accept-version: ~7.3

#### Example Response

    HTTP/1.1 204 No Content
    Content-Type: application/json
    Server: Joyent SmartDataCenter 7.3.0
    Api-Version: 7.3.0


## ListFabricNetworks (GET /:login/fabrics/default/vlans/:vlan_id/networks)

Lists all of the networks in a fabric on the VLAN specified by `:vlan_id`.

### Inputs

* None

### Returns

Returns an array of Network Objects. Each network object has the following
information:

||**Field**||**Type**||**Description**||
||id||String||Unique identifier for this network||
||name||String||The network name||
||public||Boolean||Whether this a public or private (rfc1918) network||
||fabric||Boolean||Whether this network is created on a fabric||
||description||String||Description of this network (optional)||
||subnet||String||A CIDR formatted string that describes the network||
||provision_start_ip||String||The first IP on the network that may be assigned||
||provision_end_ip||String||The last IP on the network that may be assigned||
||gateway||String||Optional Gateway IP address||
||resolvers||String||Resolver IP addresses||
||routes||Routes Object||Optional Static routes for hosts on this network||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:vlan_id` does not exist||

### CLI

    $ sdc-fabric network list

#### Example Request

    GET /login/fabrics/default/vlans/2/networks HTTP/1.1
    Authorization: Basic ...
    Host: api.example.com
    Accept: application/json
    Accept-version: ~7.3

#### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Server: Joyent SmartDataCenter 7.3.0
    Api-Version: 7.3.0

    [
      {
        "id": "7326787b-8039-436c-a533-5038f7280f04",
        "name": "default",
        "public": false,
        "fabric": true,
        "gateway": "192.168.128.1",
        "provision_end_ip": "192.168.131.250",
        "provision_start_ip": "192.168.128.5",
        "resolvers": [
          "8.8.8.8",
          "8.8.4.4"
        ],
        "subnet": "192.168.128.0/22",
        "vlan_id": 2
      },
      {
        "id": "7fa999c8-0d2c-453e-989c-e897716d0831",
        "name": "newnet",
        "public": false,
        "fabric": true,
        "provision_end_ip": "10.50.1.20",
        "provision_start_ip": "10.50.1.2",
        "resolvers": [
          "8.8.8.8"
        ],
        "subnet": "10.50.1.0/24",
        "vlan_id": 2
      }
    ]


## CreateFabricNetwork (POST /:login/fabrics/default/vlans/:vlan_id/networks)

### Inputs

||**Field**||**Type**||**Description**||
||name||String||The network name, it must be unique||
||description||String||Description of this network (optional)||
||subnet||String||A CIDR formatted string that describes the network||
||provision_start_ip||String||The first IP on the network that may be assigned||
||provision_end_ip||String||The last IP on the network that may be assigned||
||gateway||String||Optional Gateway IP address||
||resolvers||String||Optional Resolver IP addresses||
||routes||Routes Object||Optional Static routes for hosts on this network||

### Returns

Network Object:

||**Field**||**Type**||**Description**||
||id||String||Unique identifier for this network||
||name||String||The network name||
||public||Boolean||Whether this a public or private (rfc1918) network||
||fabric||Boolean||Whether this network is created on a fabric||
||description||String||Description of this network (optional)||
||subnet||String||A CIDR formatted string that describes the network||
||provision_start_ip||String||The first IP on the network that may be assigned||
||provision_end_ip||String||The last IP on the network that may be assigned||
||gateway||String||Optional Gateway IP address||
||resolvers||String||Optional Resolver IP addresses||
||routes||Routes Object||Optional Static routes for hosts on this network||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If :login does not exist||

### CLI

    $ sdc-fabric network create

#### Example Request

    POST /login/fabrics/default/vlans/2/networks HTTP/1.1
    Authorization: Basic ...
    Host: api.example.com
    Accept: application/json
    Accept-version: ~7.3

    {
      "name": "newnet",
      "provision_end_ip": "10.50.1.20",
      "provision_start_ip": "10.50.1.2",
      "resolvers": [
        "8.8.8.8"
      ],
      "subnet": "10.50.1.0/24"
    }

#### Example Response

    HTTP/1.1 201 Created
    Content-Type: application/json
    Server: Joyent SmartDataCenter 7.3.0
    Api-Version: 7.3.0

    {
      "id": "7fa999c8-0d2c-453e-989c-e897716d0831",
      "name": "newnet",
      "public": false,
      "fabric": true,
      "provision_end_ip": "10.50.1.20",
      "provision_start_ip": "10.50.1.2",
      "resolvers": [
        "8.8.8.8"
      ],
      "subnet": "10.50.1.0/24",
      "vlan_id": 2
    }

## GetFabricNetwork (GET /:login/fabrics/default/vlans/:vlan_id/networks/:id)

### Inputs

* None

### Returns

The details of the network object:

||**Field**||**Type**||**Description**||
||id||String||Unique identifier for this network||
||name||String||The network name||
||public||Boolean||Whether this a public or private (rfc1918) network||
||fabric||Boolean||Whether this network is created on a fabric||
||description||String||Description of this network (optional)||
||subnet||String||A CIDR formatted string that describes the network||
||provision_start_ip||String||The first IP on the network that may be assigned||
||provision_end_ip||String||The last IP on the network that may be assigned||
||gateway||String||Optional Gateway IP address||
||resolvers||String||Optional Resolver IP addresses||
||routes||Routes Object||Optional Static routes for hosts on this network||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login`, `:vlan_id` or `id` does not exist||


### CLI

    $ sdc-fabric network get

#### Example Request

    GET /login/fabrics/default/vlans/2/networks/7fa999c8-0d2c-453e-989c-e897716d0831 HTTP/1.1
    Authorization: Basic ...
    Host: api.example.com
    Accept: application/json
    Accept-version: ~7.3

#### Example Response

    HTTP/1.1 200 OK
    Content-Type: application/json
    Server: Joyent SmartDataCenter 7.3.0
    Api-Version: 7.3.0

    {
      "id": "7fa999c8-0d2c-453e-989c-e897716d0831",
      "name": "newnet",
      "public": false,
      "fabric": true,
      "provision_end_ip": "10.50.1.20",
      "provision_start_ip": "10.50.1.2",
      "resolvers": [
        "8.8.8.8"
      ],
      "subnet": "10.50.1.0/24",
      "vlan_id": 2
    }



## DeleteFabricNetwork (DELETE /:login/fabrics/default/vlans/:vlan_id/networks/:id)

Deletes the specified Network. Note that no VMs may be provisioned on the
Network.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login`, `:vlan_id` or `id` does not exist||
||InUseError||The VLAN currently has active networks on it||

### CLI

    $ sdc-fabric network delete

#### Example Request

    DELETE /login/fabrics/default/vlans/2/networks/7fa999c8-0d2c-453e-989c-e897716d0831 HTTP/1.1
    Authorization: Basic ...
    Host: api.example.com
    Accept: application/json
    Accept-version: ~7.3

#### Example Response

    HTTP/1.1 204 No Content
    Content-Type: application/json
    Server: Joyent SmartDataCenter 7.3.0
    Api-Version: 7.3.0




# Networks

CloudAPI provides a way to get details on public and customer-specific networks
in a datacenter. This also includes all of the networks available in your
fabric.

||uuid||String||Unique identifier for this network||
||name||String||The network name||
||public||Boolean||Whether this a public or private (rfc1918) network||
||fabric||Boolean||Whether this network is created on a fabric||
||description||String||Description of this network (optional)||
||subnet||String||A CIDR formatted string that describes the network||
||provision_start_ip||String||The first IP on the network that may be assigned||
||provision_end_ip||String||The last IP on the network that may be assigned||
||gateway||String||Optional Gateway IP address||
||resolvers||String||Optional Resolver IP addresses||
||routes||Routes Object||Optional Static routes for hosts on this network||



## ListNetworks (GET /:login/networks)

List all the networks which can be used by the given account. If a network was
created on a fabric, then additional information will be shown:

### Inputs

* None

### Returns

An array of network objects.  Networks are:

||**Field**||**Type**||**Description**||
||id||String||Unique identifier for this network||
||name||String||The network name||
||public||Boolean||Whether this a public or private (rfc1918) network||
||fabric||Boolean||Whether this network is created on a fabric||
||description||String||Description of this network (optional)||

If the network is on a fabric, the following additional fields are included:

||**Field**||**Type**||**Description**||
||subnet||String||A CIDR formatted string that describes the network||
||provision_start_ip||String||The first IP on the network that may be assigned||
||provision_end_ip||String||The last IP on the network that may be assigned||
||gateway||String||Optional Gateway IP address||
||resolvers||String||Optional Resolver IP addresses||
||routes||Routes Object||Optional Static routes for hosts on this network||


### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` does not exist||

### CLI

    $ sdc-listnetworks

#### Example Request

    GET /login/networks HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    accept-version: ~7.0
    host: api.example.com
    connection: keep-alive

#### Example Response

    HTTP/1.1 200 OK
    content-type: application/json
    content-length: 158
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET, HEAD
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    connection: Keep-Alive
    content-md5: v6s92rl/nTS2Ts5CNDcgQw==
    server: Joyent SmartDataCenter 7.0.0
    api-version: 7.0.0
    request-id: 35147710-7f49-11e2-8585-bd5fc323c72c
    response-time: 134
    x-request-id: 35147710-7f49-11e2-8585-bd5fc323c72c
    x-api-version: 7.0.0
    x-response-time: 134

    [
      {
        "id": "daeb93a2-532e-4bd4-8788-b6b30f10ac17",
        "name": "external",
        "public": true
      }
    ]


## GetNetwork (GET /:login/networks/:id)

Retrieves information about an individual network.

### Inputs

* None

### Returns

||**Field**||**Type**||**Description**||
||id||String||Unique identifier for this network||
||name||String||The network name||
||public||Boolean||Whether this a public or private (rfc1918) network||
||description||String||Description of this network (optional)||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||

### CLI

    $ sdc-getnetwork daeb93a2-532e-4bd4-8788-b6b30f10ac17

#### Example Request

    GET /login/networks/daeb93a2-532e-4bd4-8788-b6b30f10ac17 HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    accept-version: ~7.0
    host: api.example.com

#### Example Response

    HTTP/1.1 200 OK
    content-type: application/json
    content-length: 156
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET, HEAD
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    server: Joyent SmartDataCenter 7.0.0
    api-version: 7.0.0
    request-id: cf1c1340-7f49-11e2-8585-bd5fc323c72c
    response-time: 203
    x-request-id: cf1c1340-7f49-11e2-8585-bd5fc323c72c
    x-api-version: 7.0.0
    x-response-time: 203

    {
      "id": "daeb93a2-532e-4bd4-8788-b6b30f10ac17",
      "name": "external",
      "public": true
    }




# Nics

CloudAPI provides a way to list, add and remove NICs attached to a machine.

## ListNics (GET /:login/machines/:id/nics)

List all the NICs on a machine belonging to a given account.

### Inputs

* None

### Returns

An array of NIC objects. NICs are:

||**Field**||**Type**||**Description**||
||ip ||String||NIC's IPv4 address||
||mac||String||NIC's MAC address||
||primary||Boolean||Whether this is the VM's primary NIC||
||netmask||String||IPv4 netmask||
||gateway||String||IPv4 gateway||
||state||String||Describes the state of the NIC (e.g. provisioning, running, or stopped)||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login or `:id` does not exist||
||InvalidArgument||If `:id` isn't a UUID||

### CLI

    $ sdc-nics list 76a533e9-aa3c-4fd4-a194-03fa05663e0e

#### Example Request

    GET /my/machine/76a533e9-aa3c-4fd4-a194-03fa05663e0e/nics HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    accept-version: ~7.1
    host: api.example.com
    connection: keep-alive

#### Example Response

    HTTP/1.1 200 OK
    content-type: application/json
    content-length: 286
    date: Sat, 03 May 2014 13:37:36 GMT
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: POST, GET, HEAD
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    connection: Keep-Alive
    content-md5: ahIN4rEEcEIJGltGn9cqRQ==
    server: Joyent SmartDataCenter 7.1.1
    api-version: 7.2.0
    request-id: 6b8c5170-d45a-11e3-8db6-c7649670227d
    response-time: 183
    x-resource-count: 1
    x-request-id: 6b8c5170-d45a-11e3-8db6-c7649670227d
    x-api-version: 7.2.0
    x-response-time: 183

    [
        {
            "mac": "90:b8:d0:2f:b8:f9",
            "primary": true,
            "ip": "10.88.88.137",
            "netmask": "255.255.255.0",
            "gateway": "10.88.88.2",
            "state": "running"
        }
    ]


## GetNic (GET /:login/machines/:id/nics/:mac)

Gets a specific NIC on a machine belonging to a given account.

NB: the `:mac` element in the path must have all the colons (':') stripped from
it in the request.

### Inputs

* None

### Returns

A NIC object:

||**Field**||**Type**||**Description**||
||ip ||String||NIC's IPv4 address||
||mac||String||NIC's MAC address||
||primary||Boolean||Whether this is the VM's primary NIC||
||netmask||String||IPv4 netmask||
||gateway||String||IPv4 gateway||
||state||String||Describes the state of the NIC (e.g. provisioning, running, or stopped)||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login`, `:id`, or `:mac` does not exist||
||InvalidArgument||If `:id` isn't a UUID, or `:mac` isn't a MAC address (without colons)||

### CLI

    $ sdc-nics get 90:b8:d0:2f:b8:f9 76a533e9-aa3c-4fd4-a194-03fa05663e0e

#### Example Request

    GET /my/machine/76a533e9-aa3c-4fd4-a194-03fa05663e0e/nics/90b8d02fb8f9 HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    accept-version: ~7.1
    host: api.example.com
    connection: keep-alive

#### Example Response

    HTTP/1.1 200 OK
    content-type: application/json
    content-length: 284
    date: Sat, 03 May 2014 13:37:36 GMT
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET, HEAD, DELETE
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    connection: Keep-Alive
    content-md5: ahIN4rEEcEIJGltGn9cqRQ==
    server: Joyent SmartDataCenter 7.1.1
    api-version: 7.2.0
    request-id: 6b8c5170-d45a-11e3-8db6-c7649670227d
    response-time: 183
    x-resource-count: 1
    x-request-id: 6b8c5170-d45a-11e3-8db6-c7649670227d
    x-api-version: 7.2.0
    x-response-time: 183

    {
        "mac": "90:b8:d0:2f:b8:f9",
        "primary": true,
        "ip": "10.88.88.137",
        "netmask": "255.255.255.0",
        "gateway": "10.88.88.2",
        "state": "running"
    }


## AddNic (POST /:login/machines/:id/nics)

Creates a new NIC on a machine belonging to a given account.

*WARNING*: this causes the machine to reboot while adding the NIC.

### Inputs

||**Field**||**Type**||**Description**||
||network||String||UUID of network this NIC should attach to||

### Returns

The newly-created NIC object:

||**Field**||**Type**||**Description**||
||ip ||String||NIC's IPv4 address||
||mac||String||NIC's MAC address||
||primary||Boolean||Whether this is the VM's primary NIC||
||netmask||String||IPv4 netmask||
||gateway||String||IPv4 gateway||
||state||String||Describes the state of the NIC (most likely 'provisioning')||

It also returns the Location in the headers where the new NIC lives in the HTTP
API. If a NIC already exists for that network, a 302 redirect will be returned
instead of the object.

NICs do not appear on a machine immediately, so the state of the new NIC can be
checked by polling that location. While the NIC is provisioning, it will have a
`state` of 'provisioning'. Once it's 'running', the NIC is active on the
machine. If the provision fails, the NIC will be removed and the location will
start returning 404.

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login` or `:id` does not exist||
||InvalidArgument||If `:id` isn't a UUID, or the `network` argument isn't a valid UUID||
||MissingParameter||If the `network` argument isn't present||

### CLI

    $ sdc-nics create 7007b198-f6aa-48f0-9843-78a3149de3d7 76a533e9-aa3c-4fd4-a194-03fa05663e0e

#### Example Request

    POST /my/machine/76a533e9-aa3c-4fd4-a194-03fa05663e0e/nics HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    accept-version: ~7.1
    host: api.example.com
    connection: keep-alive

    {
        "network": "7007b198-f6aa-48f0-9843-78a3149de3d7"
    }

#### Example Response

    HTTP/1.1 201 Created
    content-type: application/json
    content-length: 284
    date: Sat, 03 May 2014 13:37:36 GMT
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: POST, GET, HEAD
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    connection: Keep-Alive
    content-md5: ahIN4rEEcEIJGltGn9cqRQ==
    location: /my/machines/76a533e9-aa3c-4fd4-a194-03fa05663e0e/nics/90b8d02fb8f9
    server: Joyent SmartDataCenter 7.1.1
    api-version: 7.2.0
    request-id: 6b8c5170-d45a-11e3-8db6-c7649670227d
    response-time: 183
    x-resource-count: 1
    x-request-id: 6b8c5170-d45a-11e3-8db6-c7649670227d
    x-api-version: 7.2.0
    x-response-time: 183

    {
        "mac": "90:b8:d0:2f:b8:f9",
        "primary": false,
        "ip": "10.88.88.137",
        "netmask": "255.255.255.0",
        "gateway": "10.88.88.2",
        "state": "provisioning"
    }


## RemoveNic (POST /:login/machines/:id/nics/:mac)

Removes a NIC on a machine belonging to a given account.

Like [AddNic](#AddNic) above, the NIC won't be removed from the machine
immediately. After the NIC is removed, it will start returning 404 through
CloudAPI.

*WARNING*: this causes the machine to reboot while removing the NIC.

### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login`, `:id` or `:mac` does not exist||
||InvalidArgument||If `:id` isn't a UUID||

### CLI

    $ sdc-nics delete 90:b8:d0:2f:b8:f9 76a533e9-aa3c-4fd4-a194-03fa05663e0e

#### Example Request

    DELETE /my/machine/76a533e9-aa3c-4fd4-a194-03fa05663e0e/nics/90b8d02fb8f9 HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    accept-version: ~7.1
    host: api.example.com
    connection: keep-alive

#### Example Response

    HTTP/1.1 204 No Content
    content-type: application/json
    content-length: 0
    date: Sat, 03 May 2014 13:37:36 GMT
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET, HEAD, DELETE
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    connection: Keep-Alive
    server: Joyent SmartDataCenter 7.1.1
    api-version: 7.2.0
    request-id: 6b8c5170-d45a-11e3-8db6-c7649670227d
    response-time: 183
    x-resource-count: 1
    x-request-id: 6b8c5170-d45a-11e3-8db6-c7649670227d
    x-api-version: 7.2.0
    x-response-time: 183



# Appendix A: Machine States

## Machine State Diagram

The following is the state diagram for a machine:

<pre>
          POST /my/machines
                     |
                     |
                     V
          +----------------+
          |  Provisioning  |
          +----------------+
                     |
                     |
                     V
          +----------------+
    +---->|     Running    |
    |     +----------------+
    |                |
    |                | action=stop
    |                V
    |     +----------------+
    |     |    Stopping    |
    |     +----------------+
    |                |
    | action=start   |
    |                V
    |     +----------------+
    +---- |     Stopped    |
          +----------------+
                     |
                     | DELETE
                     V
          +----------------+
          |  Deleted       |---+
          +----------------+   |
                               |
                              ---
                               -

</pre>

At any point the state can also be `offline`, like if there is a network or
power event to the machine.

Since version 7.0 of this API, `failed` is used to signify a failed provision.


## Polling machine state

As suggested in [CreateMachine](#CreateMachine), you can poll a machine's state
to check when that machine's provisioning has either successfully completed or
failed.  Consider the following code using
[node.js SDK](https://github.com/joyent/node-smartdc):

    var sdc = smartdc.createClient({ ... });

    function checkMachineStatus(id, state, callback) {
        return sdc.getMachine(id, function (err, machine) {
            if (err) {
                if (err.statusCode === 410 && state === 'deleted') {
                    return callback(null, true);
                }
                return callback(err);
            }

            if ((machine.state === 'deleted' && state !== 'deleted') ||
                machine.state === 'failed') {
                return callback(new Error('Provisioning Job failed'));
            }

            return callback(null, (machine ? machine.state === state : false));
        }, true);
    }


    function waitForMachine(id, state, callback) {
        return checkMachineStatus(id, state, function (err, ready) {
            if (err) {
                return callback(err);
            }
            if (!ready) {
                return setTimeout(function () {
                    waitForMachine(id, state, callback);
                }, (process.env.POLL_INTERVAL || 2500));
            }
            return callback(null);
        });
    }

With this code, you can poll when a machine with a given uuid is running by
doing:

    var machine = 'd19432ff-d921-4d6c-b5f9-6b0e4de6665c';
    waitForMachine(machine, 'running', function (err) {
        if (err) {
            console.error('Exiting because machine provisioning failed');
            process.exit(1);
        }

        // ... do your stuff here, the machine is running now ...
    });


## Polling machine audit

There are some cases where polling for machine state change will not work
because there won't be a state change for the requested action (e.g. "rename"),
or because the state change is short-lived thus making the transition easy to
miss (e.g. "reboot").

In such cases, consider polling a machine's historical of actions available
through a machine's [Machine Audit](#MachineAudit), wait for the desired
action to appear on that list, and check successfulness there.  Taking our
example from previous section, this is how we could check for a reboot:

    function checkMachineAction(id, action, time, cb) {
        return sdc.getMachineAudit(id, function (err, actions) {
            if (err) {
                return cb(err);
            }

            var acts = actions.filter(function (a) {
                return (a.action === action && (new Date(a.time) > time));
            });

            if (acts.length === 0) {
                return cb(null, false);
            }

            var act = acts[0];
            if (act.success !== 'yes') {
                return cb(action + ' failed');
            }

            return cb(null, true);  // success!
        }, true);
    }


    function waitForAction(id, action, time, cb) {
        console.log('Waiting for machine \'%s\' %s to complete',
                id, action);

        return checkMachineAction(id, action, time, function (err, ready) {
            if (err) {
                return cb(err);
            }

            if (!ready) {
                return setTimeout(function () {
                    waitForAction(id, action, time, cb);
                }, (process.env.POLL_INTERVAL || 2500));
            }
            return cb(null);
        });
    }

With this code, you can poll when a machine with a given uuid has rebooted by
doing:

    waitForAction(machine, 'reboot', (new Date()), function (err) {
        if (err) {
            // .. something failed
        } else {
            // ...all good, reboot happened successfully and machine is running
        }
    });




# Appendix B: Cloud Analytics

Cloud Analytics (CA) provides deep observability for systems and applications in
a SmartDataCenter cloud.  The CA service enables you to dynamically instrument
systems in the cloud to collect performance data that can be visualized in
real-time (through the portal), or collected using the API and analyzed later by
custom tools.  This data can be collected and saved indefinitely for capacity
planning and other historical analysis.


## Building blocks: metrics, instrumentations, and fields

A **metric** is any quantity that can be instrumented using CA.  For examples:

* Disk I/O operations
* Kernel thread executions
* TCP connections established
* MySQL queries
* HTTP server operations
* System load average

Each metric also defines which **fields** are available when data is collected.
These fields can be used to filter or decompose data.  For example, the Disk I/O
operations metric provides the fields "hostname" (for the current server's
hostname) and "disk" (for the name of the disk actually performing an
operation), which allows users to filter out data from a physical server or
break out the number of operations by disk.

You can list the available metrics using the
[DescribeAnalytics](#DescribeAnalytics) API. E.g.:

    {
      "metrics": [
        {
          "module": "fs",
          "stat": "logical_ops",
          "label": "logical filesystem operations",
          "interval": "interval",
          "fields": ["pid","execname",...,"fstype","optype","latency"],
          "unit": "operations"
        }, ...  ], ...
    }

The `module` and `stat` properties together identify a metric.

When you want to actually gather data for a metric, you create an
**instrumentation**.  The instrumentation specifies:

* which metric to collect
* an optional **predicate** based on the metric's fields (e.g. only collect
  data from certain hosts, or data for certain operations)
* an optional **decomposition** based on the metric's fields (e.g. break down
  the results by server hostname)
* how frequently to aggregate data (e.g. every second, every hour, etc.)
* how much data to keep (e.g. 10 minutes' worth, 6 months' worth, etc.)
* other configuration options

Continuing the above example, if the system provides the metric "FS Operations"
with fields "optype" and "latency", an example instrumentation might specify:

* to collect data for the "FS Operations" metric (the *metric*)
* to collect only data for read operations (a *predicate*)
* to break out the results by latency (a *decomposition*)

    $ sdc-createinstrumentation --module=fs --stat=logical_ops --decomposition=latency --predicate='{"eq": ["optype","read"]}'

When we create an instrumentation, the system dynamically instruments the
relevant software and starts gathering data.  The data is made available
immediately in real-time.  To get the data for a particular point in time, you
retrieve the **value** of the instrumentation for that time:

    $ sdc-getinstrumentation --value 4
    {
      "value": [
        [ [ 17000, 17999 ], 12 ],
        [ [ 18000, 18999 ], 12 ],
        ...
      ],
      "transformations": {},
      "start_time": 1309383598,
      "duration": 1,
      "nsources": 1,
      "minreporting": 1,
      "requested_start_time": 1309383598,
      "requested_duration": 1,
      "requested_end_time": 1309383599
    }

To summarize: *metrics* define what data the system is capable of reporting.
*Fields* enhance the raw numbers with additional metadata about each event that
can be used for filtering and decomposition.  *Instrumentations* specify which
metrics to actually collect, what additional information to collect from each
metric, and how to store that data.  When you want to retrieve that data, you
query the service for the *value* of the instrumentation.


## Values and visualizations

We showed above how fields can be used to decompose results.  Let's look at that
in more detail.  We'll continue using the "FS Operations" metric with
fields "optype".

### Scalar values

Suppose we create an instrumentation with no filter and no decomposition.  Then
the value of the instrumentation for a particular time interval might look
something like this:

    {
      start_time: 1308789361,
      duration: 1,
      value: 573
      ...
    }

In this case, `start_time` denotes the start of the time interval in Unix time,
`duration` denotes the length of the interval in seconds, and `value` denotes
the actual value.  This means that 573 FS operations completed on all
systems for a user in the cloud between times 1308789361 and 1308789362.

### Discrete decompositions

Now suppose we create a new instrumentation with a decomposition by `execname`.
Then the raw value might look something like this:

    {
      start_time: 1308789361,
      duration: 1,
      value: {
        ls: 1,
        cat: 49,
        ...
      }
      ...
    }

We call the decomposition by `execname` a **discrete decomposition** because the
possible values of execname ("ls", "cat", ...) are not numbers.

### Numeric decompositions

It's useful to decompose some metrics by numeric fields.  For example, you might
want to view FS operations decomposed by latency (how long the operation
took).  The result is a statistical *distribution*, which groups nearby
latencies into buckets and shows the number of disk I/O operations that fell
into each bucket. The result looks like this:

    {
      "start_time": 1308863061,
      "duration": 1,
      "value": [
        [ [ 53000, 53999 ], 4 ],
        [ [ 54000, 54999 ], 4 ],
        [ [ 55000, 55999 ], 7 ],
        ...
        [ [ 810000, 819999 ], 1 ]
      ]
    }

That data indicates that at time 1308863061, the system completed:

* 4 requests with latency between 53 and 54 microseconds,
* 4 requests with latency between 54 and 55 microseconds,
* 7 requests between 55 and 56 microseconds, and so on, and finally
* 1 request with latency between 810 and 820 microseconds.

This type of instrumentation is called a **numeric decomposition**.

### Combining decompositions

It's possible to combine a single discrete and numeric decomposition to produce
an object mapping discrete key to numeric distribution, whose value looks like
this:

    {
      "start_time": 1308863799,
      "duration": 1,
      "value": {
        "ls": [
          [ [ 110000, 119999 ], 1 ],
          [ [ 120000, 129999 ], 1 ],
          ...
          [ [ 420000, 429999 ], 1 ],
          [ [ 25000000, 25999999 ], 1 ]
        ]
      }
    }

As we will see, this data allows clients to visualize the distribution of I/O
latency, and then highlight individual programs in the distribution (or whatever
field you broke it down along).

### Value-related properties

We can now explain several of the instrumentation properties shown previously:

* `value-dimension`: the number of dimensions in returned values, which is
  the number of decompositions specified in the instrumentation, plus 1.
  Instrumentations with no decompositions have dimension 1 (scalar values).
  Instrumentations with a single discrete or numeric decomposition have value 2
  (vector values).  Instrumentations with both a discrete and numeric
  decomposition have value 3 (vector of vectors).
* `value-arity`: describes the format of individual values
    * `scalar`: the value is a scalar value (a number)
    * `discrete-decomposition`: the value is an object mapping discrete keys to
      scalars
    * `numeric-decomposition`: the value is either an object (really an array of
      arrays) mapping buckets (numeric ranges) to scalars, or an object mapping
      discrete keys to such an object.  That is, a numeric decomposition is one
      which contains at the leaf a distribution of numbers.

The arity serves as a hint to visualization clients: scalars are typically
rendered as line or bar graphs, discrete decompositions are rendered as stacked
or separate line or bar graphs, and numeric decompositions are rendered as
heatmaps.

### Predicate Syntax

Predicates allow you to filter out data points based on the *fields* of a
metric.  For example, instead of looking at FS operations for your whole
cloud, you may only care about operations with latency over 100ms, or on a
particular machine.

Predicates are represented as JSON objects using an LISP-like syntax.  The
primary goal for predicate syntax is to be very easy to construct and parse
automatically, making it easier for people to build tools to work with them.

The following leaf predicates are available:

`{ eq: [ fieldname, value ] }`: equality (string or number, as appropriate).
`{ ne: [ fieldname, value ] }`: inequality (string or number, as appropriate).
`{ le: [ fieldname, value ] }`: less than or equal to (numbers only).
`{ lt: [ fieldname, value ] }`: less than (numbers only).
`{ ge: [ fieldname, value ] }`: greater than or equal to (numbers only).
`{ gt: [ fieldname, value ] }`: greater than (numbers only).

Additionally, the following compound predicates are available:

`{ and: [ predicate, ... ] }`: all of subpredicates must be true.
`{ or: [ predicate, ... ] }`: at least one of subpredicates must be true.

All of these can be combined to form complex filters for drilling down.  For
example, this predicate:

    {
      and: {
        { eq: [ "execname", "mysqld" ] }
        { gt: [ "latency", 100000000 ] },
        { or: [
          { eq: [ "hostname", "host1" ] },
          { eq: [ "hostname", "host2" ] },
          { eq: [ "hostname", "host3" ] }
        ] },
      }
    }

This predicate could be used with the "logical filesystem operations" metric to
identify file operations performed by MySQL on machines "host1", "host2", or
"host3" that took longer than 100ms.

### Heatmaps

Up to this point we have been showing **raw values**, which are JSON
representations of the data exactly as gathered by Cloud Analytics. However, the
service may provide other representations of the same data.  For numeric
decompositions, the service provides several **heatmap** resources that generate
heatmaps, like this one:

<img src="media/img/heatmap.png" />

Like raw values, heatmap values are returned using JSON, but instead of
specifying a `value` property, they specify an `image` property whose contents
are a base64-encoded PNG image.  For details, see the API reference.  Using the
API, it's possible to specify the size of the image, the colors used, which
values of the discrete decomposition to select, and many other properties
controlling the final result.

Heatmaps also provide a resource for getting the details of a particular heatmap
bucket, which looks like this:

    {
      "start_time": 1308865184,
      "duration": 60,
      "nbuckets": 100,
      "width": 600,
      "height": 300,
      "bucket_time": 1308865185,
      "bucket_ymin": 10000,
      "bucket_ymax": 19999,
      "present": {
        "ls": 5,
        "cat": 57
      },
      "total": 1,
    }

This example indicates the following about the particular heatmap bucket we
clicked on:

* the time represented by the bucket is 1308865185
* the bucket covers a latency range between 10 and 20 microseconds
* at that time and latency range, program `ls` completed 5 operations and
  program `cat` completed 57 operations.

This level of detail is critical for understanding hot spots or other patterns
in the heatmap.


## Data granularity and data retention

By default, CA collects and saves data each second for ten minutes.  So if you
create an instrumentation for FS operations, the service will save the
per-second number of FS operations going back for the last ten minutes.  These
parameters are configurable using the following instrumentation properties:

* `granularity`: how frequently to aggregate data, in seconds.  The default is
  one second.  For example, a value of 300 means to aggregate every five
  minutes' worth of data into a single data point.  The smaller this value, the
  more space the raw data takes up.  `granularity` cannot be changed after an
  instrumentation is created.
* `retention-time`: how long, in seconds, to keep each data point.  The default
  is 600 seconds (ten minutes).  The higher this value, the more space the raw
  data takes up.  `retention-time` can be changed after an instrumentation is
  created.

These values affect the space used by the instrumentation's data.  For example,
all things being equal, the following all store the same amount of data:

* 10 minutes' worth of per-second data (600 data points)
* 50 minutes' worth of per-5-second data
* 25 days' worth of per-hour data
* 600 days' worth of per-day data

The system imposes limits on these properties so that each instrumentation's
data cannot consume too much space.  The limits are expressed internally as a
number of data points, so you can adjust granularity and retention-time to match
your needs.  Typically, you'll be interested in either per-second data for live
performance analysis, or an array of different granularities and retention-times
for historical usage patterns.


## Data persistence

By default, data collected by the CA service is only cached in memory, not
persisted to disk.  As a result, transient failures of the underlying CA service
instances can result in loss of the collected data.  For live performance
analysis, this is likely not an issue, since the likelihood of a crash is low
and the data can probably be collected again.  For historical data being kept
for days, weeks, or even months, it's necessary to persist data to disk.  This
can be specified by setting the `persist-data` instrumentation property to
"true".  In that case, CA will ensure that data is persisted at approximately
the `granularity` interval of the instrumentation, but no more frequently than
every few minutes.  (For that reason, there's little value in persisting an
instrumentation whose retention time is only a few minutes.)


## Transformations

Transformations are post-processing functions that can be applied to data when
it's retrieved.  You do not need to specify transformations when you create an
instrumentation; you need only specify them when you retrieve the value.
Transformations map values of a discrete decomposition to something else.  For
example, a metric that reports HTTP operations decomposed by IP address supports
a transformation that performs a reverse-DNS lookup on each IP address so that
you can view the results by hostname instead.  Another transformation maps IP
addresses to geolocation data for displaying incoming requests on a world map.

Each supported transformation has a name, like "reversedns".  When a
transformation is requested for a value, the returned value includes a
`transformations` object with keys corresponding to each transformation (e.g.,
"reversedns").  Each of these is an object mapping keys of the discrete
decomposition to transformed values.  For example:

    {
      "value": {
        "8.12.47.107": 57
      },
      "transformations": {
        "reversedns": {
          "8.12.47.107": [ "joyent.com" ]
        }
      },
      "start_time": 1308863799,
      "duration": 1,
      "nsources": 1,
      "minreporting": 1,
      "requested_start_time": 1308863799,
      "requested_duration": 1,
      "requested_end_time": 1308863800
    }

Transformations are always performed asynchronously and the results cached
internally for future requests.  So the first time you request a transformation
like "reversedns", you may see no values transformed at all.  As you retrieve
the value again, the system will have completed the reverse-DNS lookup for
addresses in the data and they will be included in the returned value.




# Appendix C: HTTP Signature Authentication

In addition to HTTP Basic Authentication, CloudAPI supports a new mechanism for
authenticating HTTP requests based on signing with your SSH private key.
Specific examples of using this mechanism with SDC are given here. Reference the
`HTTP Signature Authentication` specification by Joyent, Inc. for complete
details.

A node.js library for HTTP Signature is available with:

    $ npm install http-signature@0.9.11


## CloudAPI Specific Parameters

The `Signature` authentication scheme is based on the model that the client must
authenticate itself with a digital signature produced by the private key
associated with an SSH key under your account (see `/my/keys` above).  Currently
only RSA signatures are supported.  You generate a signature by signing the
value of the HTTP `Date` header.

As an example, assuming that you have associated an RSA SSH key with your
account, called 'rsa-1', the following request is what you would send for a
`ListMachines` request:

    GET /my/machines HTTP/1.1
    Host: api.example.com
    Date: Sat, 11 Jun 2011 23:56:29 GMT
    Authorization: Signature keyId="/demo/keys/rsa-1",algorithm="rsa-sha256" <Base64(rsa(sha256($Date)))>
    Accept: application/json
    Api-Version: ~7.0

Where the signature is attached with the
`Base64(rsa(sha256(Sat, 11 Jun 2011 23:56:29 GMT)))` output.  Note that the
`keyId` parameter **cannot** use the *my* shortcut, as in the HTTP resource
paths. This is because CloudAPI must lookup your account to resolve the key, as
with Basic authentication.  In short, you **MUST** use the login name associated
to your account to specify the `keyId`.


## Sample Code

Sample code for generating the `Authorization` header (and `Date` header):

    var crypto = require('crypto');
    var fs = require('fs');
    var https = require('https');



    /**
     * Simply pads a number < 10 with a leading 0.
     *
     * @param {String} val a numeric string.
     * @return {String} a new value that may have a leading 0.
     */
    function pad(val) {
      if (parseInt(val, 10) < 10)
        val = '0' + val;
      return val;
    }


    /**
     * Generates an RFC 1123 compliant Date String
     *
     * @return {String} RFC 1123 date string.
     */
    function httpDate() {
      var now = new Date();
      var months = ['Jan',
                    'Feb',
                    'Mar',
                    'Apr',
                    'May',
                    'Jun',
                    'Jul',
                    'Aug',
                    'Sep',
                    'Oct',
                    'Nov',
                    'Dec'];
      var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return days[now.getUTCDay()] + ', ' +
                  pad(now.getUTCDate()) + ' ' +
                  months[now.getUTCMonth()] + ' ' +
                  now.getUTCFullYear() + ' ' +
                  pad(now.getUTCHours()) + ':' +
                  pad(now.getUTCMinutes()) + ':' +
                  pad(now.getUTCSeconds()) +
                  ' GMT';
    }


    ///--- Mainline

    // Read in an SSH key from the "usual" location.
    var file = process.env.HOME + '/.ssh/id_rsa';
    var key = fs.readFileSync(file, 'ascii');
    if (!key)
      throw new Error(file + ' was not a valid RSA key');

    var date = httpDate();
    var signer = crypto.createSign('RSA-SHA256');
    signer.update(date);
    authz = 'Signature keyId="/mark/keys/rsa-1",algorithm="rsa-sha256" ' + signer.sign(key, 'base64');

    var request = {
      host: 'api.example.com',
      path: '/my/machines',
      headers: {
        'x-api-version': '~7.0',
        'Date': date,
        'Authorization': authz
      }
    };
    https.get(request, function(res) {
      console.log('STATUS: ' + res.statusCode);
      console.log('HEADERS: ' + JSON.stringify(res.headers, null, 2));
      res.setEncoding('utf8');
      res.body = '';
      res.on('data', function(chunk) {
        res.body += chunk;
      });
      res.on('end', function() {
        console.log('BODY: ' + JSON.stringify(res.body, null, 2));
      });
    }).end();




# Appendix D: CloudAPI CLI Commands

||**Command**||**Description**||
||[sdc-addmachinetags](#AddMachineTags)||Allows you to add additional tags, other than those set at provisioning time.||
||[sdc-chmod](#SetRoleTags)||Add role tags to CloudAPI resources.||
||[sdc-createfirewallrule](#CreateFirewallRule)||Add a new firewall rule.||
||[sdc-createimagefrommachine](#CreateImageFromMachine)||Create a new custom image from a machine.||
||[sdc-createinstrumentation](#CreateInstrumentation)||Creates an instrumentation.||
||[sdc-createkey](#CreateKey)||Uploads a new OpenSSH key to SmartDataCenter.||
||[sdc-createmachine](#CreateMachine)||Allows you to provision a machine.||
||[sdc-createmachinesnapshot](#CreateMachineSnapshot)||Allows you to take a snapshot of a machine.||
||[sdc-deletefirewallrule](#DeleteFirewallRule)||Removes a given firewall rule.||
||[sdc-deleteimage](#DeleteImage)||Delete a private image.||
||[sdc-deleteinstrumentation](#DeleteInstrumentation)||Destroys an instrumentation.||
||[sdc-deletekey](#DeleteKey)||Deletes an SSH key by name.||
||[sdc-deletemachine](#DeleteMachine)||Allows you to completely destroy a machine.||
||[sdc-deletemachinemetadata](#DeleteMachineMetadata)||Deletes a single metadata key from this machine.||
||[sdc-deletemachinesnapshot](#DeleteMachineSnapshot)||Deletes the specified snapshot of a machine.||
||[sdc-deletemachinetag](#DeleteMachineTag)||Deletes a single tag from this machine.||
||[sdc-describeanalytics](#DescribeAnalytics)||Retrieves the "schema" for instrumentations that can be created using the analytics endpoint.||
||[sdc-disablefirewallrule](#DisableFirewallRule)||Disable an enabled firewall rule.||
||[sdc-disablemachinefirewall](#DisableMachineFirewall)||Completely disable the firewall on a machine.||
||[sdc-enablefirewallrule](#EnableFirewallRule)||Enable a disabled firewall rule.||
||[sdc-enablemachinefirewall](#EnableMachineFirewall)||Enable the firewall on a machine.||
||[sdc-exportimage](#ExportImage)||Export an image to Manta.||
||[sdc-fabric](#Fabrics)||Administer fabric networks and VLANs.||
||[sdc-getaccount ](#GetAccount)||Gets details about your account.||
||[sdc-getdataset](#GetDataset)||Gets an individual dataset by id. (deprecated)||
||[sdc-getfirewallrule](#GetFirewallRule)||Get details about a specific firewall rule.||
||[sdc-getimage](#GetImage)||Gets an individual image by id.||
||[sdc-getinstrumentation](#GetInstrumentation)||Retrieves the configuration for an instrumentation.||
||[sdc-getkey](#GetKey)||Retrieves an individual key record.||
||[sdc-getmachine](#GetMachine)||Gets the details for an individual machine.||
||[sdc-getmachineaudit](#MachineAudit)||Get a historical list of actions performed on a machine.||
||[sdc-getmachinemetadata](#GetMachineMetadata)||Returns the complete set of metadata associated with this machine.||
||[sdc-getmachinesnapshot](#GetMachineSnapshot)||Gets the state of the named snapshot.||
||[sdc-getmachinetag](#GetMachineTag)||Returns the value for a single tag on this machine.||
||[sdc-getnetwork](#GetNetwork)||Gets a network by the given id.||
||[sdc-getpackage](#GetPackage)||Gets a package by name.||
||sdc-info||List of role-tags assigned to a given resource.||
||[sdc-listdatacenters](#ListDatacenters)||Provides a list of all datacenters this cloud is aware of.||
||[sdc-listdatasets](#ListDatasets)||Provides a list of datasets available in this datacenter. (deprecated)||
||sdc-listfirewallrulemachines||||
||[sdc-listfirewallrules](#ListFirewallRules)||List all firewall rules applying to this account.||
||[sdc-listimages](#ListImages)||Provides a list of images available in this datacenter.||
||[sdc-listinstrumentations](#ListInstrumentations)||Retrieves all currently created instrumentations.||
||[sdc-listkeys](#ListKeys)||Lists all public keys we have on record for the specified account.||
||sdc-listmachinefirewallrules||List firewall rules applying to a specific machine.||
||[sdc-listmachines](#ListMachines)||Lists all machines on an account.||
||[sdc-listmachinesnapshots](#ListMachineSnapshots)||Lists all snapshots taken for a given machine.||
||[sdc-listmachinetags](#ListMachineTags)||Returns the complete set of tags associated with this machine.||
||[sdc-listnetworks](#ListNetworks)||Provides a list of networks available to the user in this datacenter.||
||[sdc-listpackages](#ListPackages)||Provides a list of packages available in this datacenter.||
||[sdc-policy](#Policies)||Add, list, update and remove policies.||
||[sdc-rebootmachine](#RebootMachine)||Allows you to 'reboot' a machine.||
||[sdc-renamemachine](#RenameMachine)||Rename a machine.||
||[sdc-replacemachinetags](#ReplaceMachineTags)||Replace all tags on a machine.||
||[sdc-resizemachine](#ResizeMachine)||Allows you to resize a SmartMachine.||
||[sdc-role](#Roles)||Add, list, update and remove roles.||
||[sdc-setup](#set-up-your-cli)||Sets up an account on a datacenter for use with this CLI.||
||[sdc-startmachine](#StartMachine)||Allows you to boot up a machine||
||[sdc-startmachinefromsnapshot](#StartMachineFromSnapshot)||Starts a stopped machine from the referenced snapshot.||
||[sdc-stopmachine](#StopMachine)||Allows you to shut down a machine.||
||[sdc-updateaccount](#UpdateAccount)||Change details of the current account.||
||[sdc-updatefirewallrule](#UpdateFirewallRule)||Change a firewall rule.||
||[sdc-updateimage](#UpdateImage)||Update metadata about an image.||
||[sdc-updatemachinemetadata](#UpdateMachineMetadata)||Allows you to update the metadata for a given machine.||
||[sdc-user](#Users)||Add, update and remove account users and their keys.||




# Appendix E: SDC 7 Changelog

CloudAPI and SmartDC CLI have been completely rewritten for SDC 7.0.  Notably,
required version of Node.js to run the CLI is now greater or equal than 0.8.14.

Most of the commands remain the same, taking exactly the same options and
returning exactly the same JSON information in an attempt to preserve backwards
compatibility between 6.5 and 7.0 API clients, and software built for 6.5.

There are some important differences between SDC 7.0 and the previous version,
where the main one is:

* The request version of SDC 7.0 CLI is `~7.0` instead of `6.5`.

* This means that the parameter `--image` (or the equivalent `-e` short option)
is mandatory for the command `sdc-createmachine`.  On previous versions of the
API, it was possible to provision a machine without specifying an image to the
create machine command.  This behavior has been deprecated, and the desired
image **must** be specified.

* Starting with version 7.0, there isn't a `default` image.  For backward
compatibility purposes, when a request using `~6.5` is received, the latest
version of the `smartos` image will become the default one.

* Starting with version 7.0, virtual machines can also be resized, but **only
resizing virtual machines to a higher capacity/package is supported**.

* Version 7.0 also deprecates the `URN` attribute for any entity, either Images
or Packages.  URN support will finish with SDC 6.5 support.

* Starting with version 7.0, packages listed by GET `/:account/packages` accept
search filters.  Additionally, the package members `vcpus`, `id` and `version`
are included on packages, as explained in the
[packages section](#packages-description).

* Starting with version 7.0, a historical list of actions performed on machines
is available through request `GET /:account/machines/:id/audit`.

* Starting with version 7.0, customers can manage Firewall Rules through the
`/:account/fwrules` resource, as explained in the
[Firewall Rules section](#FirewallRules).

* Starting with version 7.0, `GET /:account` exposes account details, and allows
the modification of account properties -- with the exception of `password` and
`login` -- through `POST /:account`.  Details are explained in the
[Account section](#Account)

* Starting with version 7.0, networks details are exposed through the
`/:account/networks` resource, as explained in the
[Networks section](#Networks).

* Starting with version 7.0,  node-smartdc's `sdc-createmachine` accepts an
optional `--networks|-w` argument, which can be set to the `id` of one or more
of the networks retrieved from `/:account/networks`.

* Starting with version 7.1.0, customer image management is made available,
allowing [Machine Creation from Images](#CreateImageFromMachine),
[exporting images to the specified manta path](#ExportImage) and
[custom images deletion](#DeleteImage).

* Starting with version 7.1.1, firewall rules will include information regarding
rules being global or not, and will optionally include a human-readable
description for the rules (which can be modified except for the global rules).

* Starting with version 7.2.0, RBAC has been made available on the CloudAPI
interface. Accounts can create users, rules can be created and combined to make
policies, policies and users can be associated together using roles, and role
tags can be applied to CloudAPI resources.




* Version 7.1.0 now adds the listing and manipulation of NICs on VMs.

# Appendix F: SDC 6.5 Support

**Version 6.5 of the API will not be supported longer than a period of six
months after the public release of SDC 7.0.**

During this period, backwards compatibility will be granted in order to give
3rd-party software built on top of the previous API version time enough to
migrate to the new version.


<p style="min-height: 31px; margin-top: 60px; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 10px 0">
<a rel="license" href="http://creativecommons.org/licenses/by-sa/3.0/"><img alt="Creative Commons License" style="border-width:0;float:left;margin:4px 8px 0 0;" src="https://i.creativecommons.org/l/by-sa/3.0/88x31.png" /></a> <span xmlns:dct="http://purl.org/dc/terms/" href="http://purl.org/dc/dcmitype/Text" property="dct:title" rel="dct:type">Joyent CloudAPI Documentation</span> by <a xmlns:cc="http://creativecommons.org/ns#" href="http://www.joyent.com" property="cc:attributionName" rel="cc:attributionURL">Joyent, Inc.</a> is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-sa/3.0/">Creative Commons Attribution-ShareAlike 3.0 Unported License</a>.
</p>
