---
title: Joyent CloudAPI Developer's Guide
mediaroot: ./media
apisections:
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

# Overview

If you're here, you're probably trying to plumb through a new interface or
modify an existing endpoint in CloudAPI. CloudAPI, as you likely know, is the
primary interface to the system. Unlike many of the other *api components, it
has stricter versioning requirements. Breaking an API here, has the ability to
impact and break all of our customers.

# Setting up a Development Environment

TODO Fill this out

# Testing and Deploying your Changes

TODO Fill this out

# Adding New Endpoints and Versioning

So, you want to add a new endpoint, or change how something behaves, and you're
asking yourself, well, how do I deal with this in the light of versioning. In
fact, what is this versioning and how does it even work?

## Versioning Background

Restify supports the notion of allowing a client to specify a version by passing
an `Accept-Version` header, which specifies the version of the API that the
client wishes to use. The version that the client specifies influences and
changes the behavior of some of our routes, sometimes leading to a different
function being called. If a client doesn't specify a version, then they'll get
the latest version in the system.

The version itself is a semver-based version and users may use semver flags
while specifying the route. For more information, and an example, see the
[Restify Documentation on Versioned
Routes](http://mcavage.me/node-restify/#versioned-routes).

While strict versioning does allow us the opportunity to break clients, care
should be given around that. If we break them, then if they need new
functionality, they'll have to rewrite everything. Breaking changes should not
be taken lightly.

If you'd like to see versioning from a slightly different perspective, you
should read
[README.mapfiles](http://src.illumos.org/source/xref/illumos-gate/usr/src/lib/README.mapfiles)
which describes how illumos versions symbols and shared libraries.

## Adding a New Version

So, you're exposing some great new CloudAPI functionality, that's great. As part
of that, you're going to have to revise the version of CloudAPI and update a
bunch of things.

### Picking a Version

The first step is to figure out what the new version will be. With the exception
of when we did the transition from SDC 6.5 to SDC 7, we do not rev the major
number. If you're adding new functionality, you should instead rev the minor
number. For example, if the current version of CloudAPI is `7.3.0`, the next
version would be `7.4.0`. Note, the minor number isn't something that wraps at
10, it can keep going up as far as we need it to.

### Updating Everything Else

By default, if a route does not specify a version, then it works in _every_
version. However, if a route specifies a version, then we have to list all of
the versions that the route supports.

When manipulating versions here are the rules:

* A version must never be removed from a route
* Only new versions may be added to a route, you cannot go back and add an old
  version.
* If a route does not have a version, and you're not changing it, don't add a
  version

So, to add a new version, you should do the following:

1) Update the package.json to refer to the new version
2) Update lib/app.js and add the previous version to the `config.version` array.
3) Update all existing routes that have a version entry, and add your version to
them.

### Write your New Route

Here, you should go through and write your new route. The route must include a
version array. The only entry that should be in the version array is the version
that you added, it should not be present in any other version, as it did not
exist.

### Updating Documentation

In addition to the normal documentation updates that need to happen with the
introduction of a new route, you must add an entry to `Appendix E: SDC 7
Changelog` in `docs/index.restdown`.

## Changing Behavior Across Versions

You may encounter a case where the behavior of an endpoint needs to vary based
on the requested version. In your code, you can get to the version of the
request by calling `getVersion()` on the request object. Using this you can
alter the behavior as necessary.

As an alternative approach, you can also add a new route that covers the same
path but has different versions from the existing version. That way, if the
behavior, inputs, or outputs are radically different across versions, you can
simply use different functions to implement the route as appropriate.
