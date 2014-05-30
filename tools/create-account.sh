#!/bin/bash
#
# Copyright (c) 2014, Joyent, Inc. All rights reserved.
#
# This script assumes the file ~/.ssh/id_rsa.pub exists and is readable.
#
# create-account.sh: This script creates an UFDS account and associates
#     ~/id_rsa.pub SSH key with this account into the given ssh host.
#     Account login will be "account" and password "joypass123".
#     Additionally, the script will also create an account's sub user
#     with login "user" and password "joypass123". Both will have
#     associated the same SSH key: "~/.ssh/id_rsa.pub"
set -o xtrace
set -o errexit

if [[ $# -ne 1 ]]; then
    echo "usage: $0 <machine>"
    exit 1
fi

HOST=$1

# Allow callers to pass additional flags to ssh and scp
[[ -n ${SSH} ]] || SSH=ssh
[[ -n ${SCP} ]] || SCP=scp

FINGERPRINT=`ssh-keygen -l -f ~/.ssh/id_rsa.pub | awk '{print $2}' | tr -d '\n'`

cat << EOM > /tmp/account.ldif
dn: uuid=cc71f8bb-f310-4746-8e36-afd7c6dd2895, ou=users, o=smartdc
changetype: add
login: account
uuid: cc71f8bb-f310-4746-8e36-afd7c6dd2895
userpassword: joypass123
email: account@test.joyent.us
objectclass: sdcperson
approved_for_provisioning: true

dn: fingerprint=$FINGERPRINT, uuid=cc71f8bb-f310-4746-8e36-afd7c6dd2895, ou=users, o=smartdc
changetype: add
name: id_rsa
objectclass: sdcKey
fingerprint: $FINGERPRINT
openssh: `cat ~/.ssh/id_rsa.pub`

dn: uuid=dd71f8bb-f310-4746-8e36-afd7c6dd2895, uuid=cc71f8bb-f310-4746-8e36-afd7c6dd2895, ou=users, o=smartdc
changetype: add
login: user
uuid: dd71f8bb-f310-4746-8e36-afd7c6dd2895
userpassword: joypass123
email: user@test.joyent.us
objectclass: sdcPerson
objectclass: sdcAccountUser
account: cc71f8bb-f310-4746-8e36-afd7c6dd2895

dn: fingerprint=$FINGERPRINT, uuid=dd71f8bb-f310-4746-8e36-afd7c6dd2895, uuid=cc71f8bb-f310-4746-8e36-afd7c6dd2895, ou=users, o=smartdc
changetype: add
name: id_rsa
fingerprint: $FINGERPRINT
objectclass: sdcKey
openssh: `cat ~/.ssh/id_rsa.pub`
EOM

${SCP} /tmp/account.ldif ${HOST}:/var/tmp/

${SSH} ${HOST} "sdc-ldap add -f /var/tmp/account.ldif"
