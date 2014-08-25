#!/usr/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

#
# Run from the HN GZ with:
# /zones/`sdc-vmname cloudapi`/root/opt/smartdc/cloudapi/bin/setup-images-for-limits-tests.sh
export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
set -o xtrace

cd /var/tmp/

# We need to download and import nodejs 13.3.1, base 13.3.1 and ubuntu-12.04
# 2.4.2 for the different tests. This also assumes that base 13.3.0 is already
# included with the headnode.

ADMIN_UUID=$(sdc-sapi /applications?name=sdc | json -Ha metadata.ufds_admin_uuid)
OWNER='9dce1460-0c4c-4417-ab8b-25ca478c5a78'
MANIFEST_TMP="manifest.tmp"
MANIFEST="manifest"


# This is base-13.3.1:
uuid=`joyent-imgadm list os=smartos name=base version=13.3.1 -o uuid|tail -1`

# If we already have the image there is no need to re-download and re-import
set +o errexit
sdc-imgadm get ${uuid} >/dev/null 2>&1
if [[ $? -ne 0 ]]; then
    set -o errexit
    # Get the original manifest
    joyent-imgadm get $uuid > $MANIFEST_TMP

    # Replace the default admin uuid with the one at our setup
    sed -e "s/$OWNER/$ADMIN_UUID/" $MANIFEST_TMP > "$MANIFEST"
    joyent-imgadm get-file -O $uuid
    FILENAME="$uuid-file.bz2"
    sdc-imgadm import -m $MANIFEST -f $FILENAME
else
    echo "base-13.3.1 already imported, skipping."
fi


# This is nodejs-13.3.1:
uuid=`joyent-imgadm list os=smartos name=nodejs version=13.3.1 -o uuid|tail -1`

# If we already have the image there is no need to re-download and re-import
set +o errexit
sdc-imgadm get ${uuid} >/dev/null 2>&1
if [[ $? -ne 0 ]]; then
    set -o errexit
    # Get the original manifest
    joyent-imgadm get $uuid > $MANIFEST_TMP

    # Replace the default admin uuid with the one at our setup
    sed -e "s/$OWNER/$ADMIN_UUID/" $MANIFEST_TMP > "$MANIFEST"
    joyent-imgadm get-file -O $uuid
    FILENAME="$uuid-file.bz2"
    sdc-imgadm import -m $MANIFEST -f $FILENAME
else
    echo "nodejs-13.3.1 already imported, skipping."
fi

# This is ubuntu-12.04-2.4.2:
uuid=`joyent-imgadm list os=linux name=ubuntu-12.04 version=2.4.2 -o uuid|tail -1`

# If we already have the image there is no need to re-download and re-import
set +o errexit
sdc-imgadm get ${uuid} >/dev/null 2>&1
if [[ $? -ne 0 ]]; then
    set -o errexit
    OWNER='352971aa-31ba-496c-9ade-a379feaecd52'
    # Get the original manifest
    joyent-imgadm get $uuid > $MANIFEST_TMP

    # Replace the default admin uuid with the one at our setup
    sed -e "s/$OWNER/$ADMIN_UUID/" $MANIFEST_TMP > "$MANIFEST"
    joyent-imgadm get-file -O $uuid
    FILENAME="$uuid-file.bz2"
    sdc-imgadm import -m $MANIFEST -f $FILENAME
else
    echo "ubuntu-12.04-2.4.2 already imported, skipping."
fi
