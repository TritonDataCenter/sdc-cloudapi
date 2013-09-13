#!/usr/bin/bash
# -*- mode: shell-script; fill-column: 80; -*-
#
# Copyright (c) 2011 Joyent Inc., All rights reserved.
#

export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
set -o xtrace

PATH=/opt/local/bin:/opt/local/sbin:/usr/bin:/usr/sbin

role=cloudapi
# Local SAPI manifests:
CONFIG_AGENT_LOCAL_MANIFESTS_DIRS=/opt/smartdc/$role

# Include common utility functions (then run the boilerplate)
source /opt/smartdc/boot/lib/util.sh
sdc_common_setup

# Cookie to identify this as a SmartDC zone and its role
mkdir -p /var/smartdc/$role
mkdir -p /opt/smartdc/$role/ssl

/usr/bin/chown -R root:root /opt/smartdc

echo "Generating SSL Certificate"
/opt/local/bin/openssl req -x509 -nodes -subj '/CN=*' -newkey rsa:2048 \
    -keyout /opt/smartdc/$role/ssl/key.pem \
    -out /opt/smartdc/$role/ssl/cert.pem -days 365

# Add build/node/bin and node_modules/.bin to PATH
echo "" >>/root/.profile
echo "export PATH=\$PATH:/opt/smartdc/$role/build/node/bin:/opt/smartdc/$role/node_modules/.bin" >>/root/.profile

echo "Updating SMF manifest"
$(/opt/local/bin/gsed -i"" -e "s/@@PREFIX@@/\/opt\/smartdc\/cloudapi/g" /opt/smartdc/cloudapi/smf/manifests/cloudapi.xml)

echo Importing SMF manifest
/usr/sbin/svccfg import /opt/smartdc/cloudapi/smf/manifests/cloudapi.xml

# Install Amon monitor and probes for CloudAPI
TRACE=1 /opt/smartdc/cloudapi/bin/cloudapi-amon-install

echo "Adding log rotation"
logadm -w cloudapi -C 48 -s 100m -p 1h \
    /var/svc/log/smartdc-application-cloudapi:default.log

# All done, run boilerplate end-of-setup
sdc_setup_complete

exit 0
