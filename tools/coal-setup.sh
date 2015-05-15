#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

#
# Setup everything required for development/testing CloudAPI into COAL
#
# This is script is pretty much identical to coal-setup-for-image-mgmt one
# located at IMGAPI zone. Main differences are that current one has been
# upgraded to use PAPI instead of UFDS sdcPackages, and that it will fetch
# and install some Joyent Public images for testing.

if [[ -n "$TRACE" ]]; then
    export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
    set -o xtrace
fi
set -o errexit
set -o pipefail

export PATH=/usr/bin:/usr/sbin:/smartdc/bin:/opt/smartdc/bin:/opt/local/bin:/opt/local/sbin:/opt/smartdc/agents/bin



#---- support stuff

function fatal {
    echo "$0: fatal error: $*"
    exit 1
}

function cleanup {
    true
}

function errexit {
    cleanup
    [[ $1 -ne 0 ]] || exit 0
    fatal "error exit status $1"
}


function install_image {
  [[ $# -ge 1 ]] || fatal "install_image requires at least 1 argument"
  local img_uuid=$1
  local admin_uuid=$(bash /lib/sdc/config.sh -json | json ufds_admin_uuid)
  local manifest=${img_uuid}.imgmanifest

  cd /var/tmp
  [[ -f ${manifest} ]] || joyent-imgadm get $img_uuid > "${manifest}.tmp"
  [[ -f $(ls $img_uuid-file.*) ]] || joyent-imgadm get-file -O $img_uuid

  json -f "${manifest}.tmp" -e "this.owner = '$admin_uuid'" > $manifest

  /opt/smartdc/bin/sdc-imgadm import \
        -m /var/tmp/${manifest} \
        -f /var/tmp/${img_uuid}-file.* \
    && rm /var/tmp/${manifest} /var/tmp/${manifest}.tmp /var/tmp/${img_uuid}-file.*
}


function hack_imgapi_to_allow_local_custom_images {
    local imgapi_zone=$(vmadm lookup -1 alias=imgapi0)
    local manifest=/zones/$imgapi_zone/root/opt/smartdc/imgapi/sapi_manifests/imgapi/template
    if [[ -z "$(grep allowLocalCreateImageFromVm $manifest || true)" ]]; then
        echo "# Hack IMGAPI template to allow local storage CreateImageFromVM usage"
        sed -e '1 a\
            "allowLocalCreateImageFromVm": true,' -i .bak $manifest
        svcadm -z $imgapi_zone restart config-agent
    fi
}



#---- mainline

trap 'errexit $?' EXIT
START=$(date +%s)

echo "# Setup CloudAPI and prepare COAL DC for ."

[[ $(zonename) == "global" ]] || fatal "must run this from the global zone"
[[ $(bash /lib/sdc/config.sh -json | json datacenter_name) == "coal" ]] \
    || fatal "datacenter_name is not COAL, refusing to run"

echo "# Allow headnode provisioning"
sdcadm post-setup dev-headnode-prov

echo "# Setup fabrics"
sdcadm experimental portolan
sdcadm experimental fabrics --coal

# TODO: how to offer alternative to hook up to remote Manta?
hack_imgapi_to_allow_local_custom_images

echo "# Create test_128 package"
sdc-papi /packages -X POST -d '{
    "cpu_cap": 100,
    "max_lwps": 1000,
    "max_physical_memory": 128,
    "max_swap": 256,
    "name": "test_128",
    "quota": 12288,
    "zfs_io_priority": 10,
    "active": true,
    "default": false,
    "vcpus": 1,
    "version": "1.0.0"
}' | json -H

# This is base-13.4.0:
base=`joyent-imgadm list os=smartos name=base version=13.4.0 -o uuid|tail -1`
install_image $base
# Also, we need smartos image, given that's the default one for SDC 6.5
smartos=`joyent-imgadm list os=smartos name=smartos version=1.6.3 -o uuid|tail -1`
install_image $smartos

END=$(date +%s)
echo "$0 finished in $(($END - $START)) seconds"
