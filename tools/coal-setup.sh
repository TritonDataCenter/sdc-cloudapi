#!/usr/bin/bash
#
# Copyright (c) 2013, Joyent, Inc. All rights reserved.

export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
set -o xtrace


/opt/smartdc/bin/sdc-sapi /instances -X POST \
 -d "{\"service_uuid\": \"$(/opt/smartdc/bin/sdc-sapi --no-headers /services?name=cloudapi | json -a uuid)\", \"params\": { \"alias\" : \"cloudapi0\" }}"

/opt/smartdc/bin/sdc-imgadm import \
-m /usbkey/datasets/smartos-1.6.3.dsmanifest \
-f /usbkey/datasets/smartos-1.6.3.zfs.bz2
