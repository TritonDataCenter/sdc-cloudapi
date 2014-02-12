## Account Users, Groups and Roles.

Starting at version 7.2.0, [Accounts](#account) can have multiple users, groups
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

Additionally, these account users can be organized using [Groups](#groups):

    {
        id: '802fbab6-ec2b-41c3-9399-064ccb65075b',
        name: 'devs',
        members: [ 'bob', 'fred', 'pedro' ],
        roles: [ 'createMachine', 'resizeMachine', 'CreateImageFromMachine'] 
    }

Each group can have an arbitrary set of [Roles](#roles):

    {
        id: '9d99a799-8234-4dd8-b37d-9af14b96da25',
        name: 'restart machines',
        policy: [ '* can rebootMachine if requesttime::time > 07:30:00 and requesttime::time < 18:30:00 and requesttime::day in (Mon, Tue, Wed, THu, Fri)', '* can stopMachine', '* can startMachine' ],
        description: 'This is completely optional'
    }

Role's `policy` documents are used for account users access control. These
documents use [Aperture](https://github.com/joyent/node-aperture) as policy language.

# Users

## ListUsers (GET /:account/users)

## GetUser (GET /:account/users/:user)

Get an account sub-user (`:user`) either by `login` or `id`.

## CreateUser (POST /:account/users)

## UpdateUser (POST /:account/users/:user)

Update any sub-user modifiable property. ** For now, login and password changes
are not allowed **. The idea is to add an additional route for password changes
so it can be selectively allowed/disallowed using policies.

## DeleteUser (DELETE /:account/users/:user)



# Groups

## ListGroups (GET /:account/groups)

## GetGroup (GET /:account/groups/:group)

Get an account group (`:group`) either by `name` or `id`.

## CreateGroup (POST /:account/groups)

Create a new group for your account.

### Inputs

||**Field**||**Type**||**Description**||
||name||String||(Required) The group name||
||members||Array||The list of account's sub-users logins to be added to this group (Optional)||
||roles||Array||The list of account's roles to be given to this group (Optional)||

### Returns

Account group

||**Field**||**Type**||**Description**||
||name||String||The group name||
||members||Array||The list of account's sub-users logins to be added to this group (Optional)||
||roles||Array||The list of account's roles to be given to this group (Optional)||
||id||String||(UUID) Unique group identifier. Identifier purpose is just to allow group name modifications||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||InvalidArgument||If member or roles are invalid, for example, you try to add an unexisting user||
||MissingParameter||If you didn't send a name||
||ResourceNotFound||If :account does not exist||


### Example Request

    POST /my/groups HTTP/1.1
    Accept: application/json
    Content-Type: application/json
    Host: api.example.com
    Api-Version: ~7.1
    Content-Length: 40
    Authorization: Signature keyId...

    {
        "name": "reboot",
        "members": ["bob","fred","pedro"],
        "roles": ["rebootMachine"]
    }

### Example Response

    HTTP/1.1 201 Created
    Location: /my/groups/4025de02-b4b6-4041-ae72-0749e99a5ac4
    Content-Type: application/json
    Content-Length: 97
    Server: Joyent SmartDataCenter 7.1.0
    Api-Version: 7.1.0
    Request-Id: 84c20bf0-93da-11e3-a4d2-8dccf42a3df3

    {
        "id": "4025de02-b4b6-4041-ae72-0749e99a5ac4",
        "name": "reboot",
        "members": ["bob","fred","pedro"],
        "roles": ["rebootMachine"]
    }




## UpdateGroup (POST /:account/groups/:group)

Everything but id can be modified.

## DeleteGroup (DELETE /:account/groups/:group)

# Roles

## ListRoles (GET /:account/roles)

## GetRole (GET /:account/roles/:role)

Get an account role (`:role`) either by `name` or `id`.

## CreateRole (POST /:account/role)

- Same thoughts regarding role members + Do we want role members
  additionally to group members? (I mean, in CloudAPI).

## UpdateRole (POST /:account/roles/:role)

Everything but id can be modified.

## DeleteRole (DELETE /:account/roles/:role)



# SSH Keys

See account [keys](#keys) for a detailed description. Only difference is the
path from where you can access subordinated users' keys:

## ListKeys (GET /:account/users/:login/keys)

Lists all public keys we have on record for the specified account sub-user.

## GetKey (GET /:account/users/:login/keys/:key)

Retrieves the given key record either by fingerprint or name.

## CreateKey (POST /:account/users/:login/keys)

Creates a new key record.

## DeleteKey (DELETE /:account/users/:login/keys/:key)

Removes a key.
