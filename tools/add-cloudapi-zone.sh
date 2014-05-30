#!/bin/bash
#
# Copyright (c) 2014, Joyent, Inc. All rights reserved.
#
# add-cloudapi-zone.sh: This script creates the cloudapi0 zone into the
#     given ssh host
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

set +o errexit
${SSH} ${HOST} "vmadm lookup -1 alias=cloudapi0"
if [[ $? -eq 0 ]]; then
    echo "CloudAPI zone already exists."
    exit 0
fi
set -o errexit

SERVICE_UUID=$(${SSH} ${HOST} '/opt/smartdc/bin/sdc-sapi /services?name=cloudapi | json -H 0.uuid' 2>/dev/null)
ADMIN_NET=$(${SSH} ${HOST} '/opt/smartdc/bin/sdc-napi /networks?name=admin | json -H 0.uuid' 2>/dev/null)
EXTERNAL_NET=$(${SSH} ${HOST} '/opt/smartdc/bin/sdc-napi /networks?name=external | json -H 0.uuid' 2>/dev/null)
cat << EOM > /tmp/cloudapi0.json
{
    "service_uuid": "$SERVICE_UUID",
    "params": {
        "alias": "cloudapi0",
        "networks": [
            {
                "uuid": "$ADMIN_NET"
            },
            {
                "uuid": "$EXTERNAL_NET",
                "primary": true
            }
        ]
    }
}
EOM

${SCP} /tmp/cloudapi0.json ${HOST}:/var/tmp/

${SSH} ${HOST} "/opt/smartdc/bin/sapiadm provision -f /var/tmp/cloudapi0.json"
