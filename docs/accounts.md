## Account Users, Roles & Policies Management.

Starting at version 7.2.0, [Accounts](#account) can have multiple users
and roles associated with them.

While the [main account](#GetAccount) behavior remains the same, including
the [SSH keys](#keys) associated with it, now it's possible to have multiple
[Users](#users) subordinated to such account, each of them with a different
set of [SSH Keys](#sshKeys). Both, the subordinated users and their associated
ssh keys have the same format than the main account object and the keys
associated with it.

Worth mentioning is the fact that login for account's subordinated users must
be different only between the users of such account, not globally. That way,
we could have an account with login _"mark"_, another account "exampleOne" with
a subordinated user with login "mark", another account "exampleTwo" with
another subordinated user with login "mark", and so forth ...

Additionally, these account users can be organized using [Roles](#roles):

    {
        id: '802fbab6-ec2b-41c3-9399-064ccb65075b',
        name: 'devs',
        members: [ 'bob', 'fred', 'pedro' ],
        policies: [ 'createMachine', 'resizeMachine', 'CreateImageFromMachine'] 
    }

Each group can have an arbitrary set of [Policies](#policies):

    {
        id: '9d99a799-8234-4dd8-b37d-9af14b96da25',
        name: 'restart machines',
        rules: [ '* can rebootMachine if requesttime::time > 07:30:00 and requesttime::time < 18:30:00 and requesttime::day in (Mon, Tue, Wed, THu, Fri)', '* can stopMachine', '* can startMachine' ],
        description: 'This is completely optional'
    }

Policies' `rules` are used for account users access control. These
rules use [Aperture](https://github.com/joyent/node-aperture) as policy language.

# Users

## ListUsers (GET /:account/users)

Returns a list of account sub-user objects. These have the same format than the
main [account](#account) object.

### Inputs

* None

### Returns

Array of user objects. Each user object has the following fields:

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
||ResourceNotFound||If :account does not exist||

### Example Request


    GET /my/users HTTP/1.1
    Accept: application/json
    Host: api.example.com
    Api-Version: ~7.1
    Authorization: Signature keyId...


### Example Response


    HTTP/1.1 200 Ok
    Location: /my/users
    Content-Type: application/json
    Content-Length: 400
    Server: Joyent SmartDataCenter 7.1.0
    Api-Version: 7.1.0
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

Get an account sub-user (`:user`) either by `login` or `id`. (`id` purpose is
just to allow sub-user `login` modifications).


### Inputs

||**Field**||**Type**||**Description**||
||membership||Boolean||When given, the user roles will be retrieved alongside with the other fields||

### Returns

Array of user objects. Each user object has the following fields:

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
||roles||Array||User role names (only when `membership` option is present)||

### Errors

||**Error Code**||**Description**||
||ResourceNotFound||When `:account` or `:user` do not exist||

### Example Request


    GET /my/users/a4ce91ff?membership=true HTTP/1.1
    Accept: application/json
    Host: api.example.com
    Api-Version: ~7.1
    Authorization: Signature keyId...


### Example Response


    HTTP/1.1 200 Ok
    Content-Type: application/json
    Content-Length: 199
    Server: Joyent SmartDataCenter 7.1.0
    Api-Version: 7.1.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    {
        id: 'ed976ee5-80a4-42cd-b0d6-5493b7d41132',
        login: 'a4ce91ff',
        email: 'a4ce91ff_test@test.com',
        roles: ['devs', 'admins'],
        updated: '2014-02-13T09:18:46.644Z',
        created: '2014-02-13T09:18:46.644Z'
    }


## CreateUser (POST /:account/users)

Creates a new sub-user under your `account`.

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
||InvalidArgument||If any of the parameters are invalid, for example, you try to add a login name already taken by another sub user of your account||
||MissingParameter||If you didn't send a login, email or password||
||ResourceNotFound||If :account does not exist||


## UpdateUser (POST /:account/users/:user)

Update any sub-user modifiable property. Password changes
are not allowed using this route. Instead, There is an additional route
for password changes so it can be selectively allowed/disallowed for sub-users
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
||InvalidArgument||If any of the parameters are invalid, for example, you try to add a login name already taken by another sub user of your account||
||MissingParameter||If you didn't send a login, email or password||
||ResourceNotFound||If :account  or :user do not exist||



## ChangeUserPassword (POST /:account/users/:user/change_password)

Separate rule for password change so different policies can be used for an user
trying to modify other data, or only self password.


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
||InvalidArgument||The provided password and password\_confirmation didn't match||
||MissingParameter||Either password or password\_confirmation parameters are missing||
||ResourceNotFound||If :account or :user do not exist||


### Example Request

    POST /my/users/a4ce91ff/change_password HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.1
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
    Api-Version: 7.1.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    {
        id: 'ed976ee5-80a4-42cd-b0d6-5493b7d41132',
        login: 'a4ce91ff',
        email: 'a4ce91ff_test@test.com',
        updated: '2014-02-13T09:18:46.644Z',
        created: '2014-02-13T09:18:46.644Z'
    }


## DeleteUser (DELETE /:account/users/:user)


### Inputs

* None

### Returns

* None

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If :account does not exist or there isn't a user with either the `login` or `id` given as `:user` value||


#### Example Request

    DELETE /my/users/a4ce91ff HTTP/1.1
    Host: api.example.com
    Accept: application/json
    Api-Version: ~7.1
    Content-Length: 0

#### Example Response

    HTTP/1.1 204 No Content
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, DELETE
    Server: SmartDataCenter
    Connection: close
    Date: Tue, 28 Jun 2011 23:14:34 GMT
    Api-Version: 7.1.0
    RequestId: 4655EA0A-C4CB-4486-8AA9-8C8C9A0B71B1
    Response-Time: 65
    Content-Length: 0



# Roles

## ListRoles (GET /:account/roles)

## GetRole (GET /:account/roles/:role)

Get an account role (`:role`) either by `name` or `id`.

## CreateRole (POST /:account/roles)

Create a new role for your account.

### Inputs

||**Field**||**Type**||**Description**||
||name||String||(Required) The role name||
||members||Array||The list of account's sub-users logins to be added to this role (Optional)||
||policies||Array||The list of account's policies to be given to this role (Optional)||

### Returns

Account role

||**Field**||**Type**||**Description**||
||name||String||The role name||
||members||Array||The list of account's sub-users logins to be added to this role (Optional)||
||policies||Array||The list of account's policies to be given to this role (Optional)||
||id||String||(UUID) Unique role identifier. Identifier purpose is just to allow role name modifications||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||InvalidArgument||If member or policies are invalid, for example, you try to add an unexisting user||
||MissingParameter||If you didn't send a name||
||ResourceNotFound||If :account does not exist||


### Example Request

    POST /my/roles HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.1
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
    Server: Joyent SmartDataCenter 7.1.0
    Api-Version: 7.1.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    {
        "id": "4025de02-b4b6-4041-ae72-0749e99a5ac4",
        "name": "reboot",
        "members": ["bob","fred","pedro"],
        "policies": ["rebootMachine"]
    }




## UpdateRole (POST /:account/roles/:role)

Everything but id can be modified.

## DeleteRole (DELETE /:account/roles/:role)




# Policies

## ListPolicies (GET /:account/policies)

## GetPolicy (GET /:account/policies/:policy)

Get an account policy (`:policy`) either by `name` or `id`.

## CreatePolicy (POST /:account/policies)


## UpdatePolicy (POST /:account/policies/:policy)

Everything but id can be modified.

## DeletePolicy (DELETE /:account/policies/:policy)



# SSH Keys

See account [keys](#keys) for a detailed description. Only difference is the
path from where you can access subordinated users' keys:

## ListKeys (GET /:account/users/:user/keys)

Lists all public keys we have on record for the specified account sub-user.

## GetKey (GET /:account/users/:user/keys/:key)

Retrieves the given key record either by fingerprint or name.

## CreateKey (POST /:account/users/:user/keys)

Creates a new key record.

## DeleteKey (DELETE /:account/users/:user/keys/:key)

Removes a key.



===========================================


### Inputs

* None

### Returns

||**Field**||**Type**||**Description**||

### Errors

||**Error Code**||**Description**||
||InvalidArgument||...||
||MissingParameter||...||
||ResourceNotFound||If :account does not exist||

### Example Request


    POST /my/roles HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.1
    Content-Length: 40
    Authorization: Signature keyId...


### Example Response


    HTTP/1.1 201 Created
    Location: /my/roles/4025de02-b4b6-4041-ae72-0749e99a5ac4
    Content-Type: application/json
    Content-Length: 97
    Server: Joyent SmartDataCenter 7.1.0
    Api-Version: 7.1.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

