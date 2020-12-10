#!/usr/bin/bash
# -*- mode: shell-script; fill-column: 80; -*-
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2020 Joyent, Inc.
#

export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
set -o xtrace

PATH=/opt/local/bin:/opt/local/sbin:/usr/bin:/usr/sbin

role=cloudapi
SVC_ROOT="/opt/smartdc/$role"

# Include common utility functions (then run the boilerplate)
source /opt/smartdc/boot/lib/util.sh
CONFIG_AGENT_LOCAL_MANIFESTS_DIRS=/opt/smartdc/$role
sdc_common_setup

# Cookie to identify this as a SmartDC zone and its role
mkdir -p /var/smartdc/$role

/usr/bin/chown -R root:root /opt/smartdc

# Mount the delegated dataset at /data
zfs set mountpoint=/data zones/$(zonename)/data

function setup_tls_certificate() {
    if [[ -f /data/tls/key.pem && -f /data/tls/cert.pem ]]; then
        echo "TLS Certificate Exists"
    else
        echo "Generating TLS Self-signed Certificate"
        mkdir -p /data/tls
        /opt/local/bin/openssl req -x509 -nodes -subj '/CN=*' \
            -pkeyopt ec_paramgen_curve:prime256v1 \
            -pkeyopt ec_param_enc:named_curve \
            -newkey ec -keyout /data/tls/key.pem \
            -out /data/tls/cert.pem -days 3650
        cat /data/tls/key.pem >> /data/tls/cert.pem
    fi
}

# Add build/node/bin and node_modules/.bin to PATH
echo "" >>/root/.profile
echo "export PATH=/opt/smartdc/$role/build/node/bin:/opt/smartdc/$role/node_modules/.bin:\$PATH" >>/root/.profile

# Until we figure out a way to share aperture config across applications:
cp $SVC_ROOT/etc/aperture.json.in $SVC_ROOT/etc/aperture.json

# setup haproxy
function setup_cloudapi {
    local cloudapi_instances=4

    #Build the list of ports.  That'll be used for everything else.
    local ports
    for (( i=1; i<=$cloudapi_instances; i++ )); do
        ports[$i]=`expr 8080 + $i`
    done

    #To preserve whitespace in echo commands...
    IFS='%'

    #haproxy
    for port in "${ports[@]}"; do
        hainstances="$hainstances        server cloudapi-$port *:$port check inter 10s slowstart 10s error-limit 3 on-error mark-down\n"
    done

    ADMIN_IP=$(/usr/sbin/mdata-get sdc:nics | /usr/bin/json -a -c 'this.nic_tag === "admin"' ip)

    lasthainst="        server cloudapi-${ports[-1]} *:${ports[-1]} check inter 10s slowstart 10s error-limit 3 on-error mark-down\n"
    sed -e "s#@@CLOUDAPI_INSTANCES@@#$hainstances#g" -e "s/@@ADMIN_IP@@/$ADMIN_IP/g" \
        -e "s#@@CLOUDAPI_LASTINST@@#$lasthainst#g" \
        $SVC_ROOT/etc/haproxy.cfg.in > $SVC_ROOT/etc/haproxy.cfg || \
        fatal "could not process $src to $dest"

    sed -e "s/@@PREFIX@@/\/opt\/smartdc\/cloudapi/g" \
        $SVC_ROOT/smf/manifests/haproxy.xml.in > $SVC_ROOT/smf/manifests/haproxy.xml || \
        fatal "could not process $src to $dest"

    svccfg import $SVC_ROOT/smf/manifests/haproxy.xml || \
        fatal "unable to import haproxy"
    svcadm enable "pkgsrc/haproxy" || fatal "unable to start haproxy"

    #cloudapi instances
    local cloudapi_xml_in=$SVC_ROOT/smf/manifests/cloudapi.xml.in
    for port in "${ports[@]}"; do
        local cloudapi_instance="cloudapi-$port"
        local cloudapi_xml_out=$SVC_ROOT/smf/manifests/cloudapi-$port.xml
        sed -e "s#@@CLOUDAPI_PORT@@#$port#g" \
            -e "s#@@CLOUDAPI_INSTANCE_NAME@@#$cloudapi_instance#g" \
            -e "s/@@PREFIX@@/\/opt\/smartdc\/cloudapi/g" \
            $cloudapi_xml_in  > $cloudapi_xml_out || \
            fatal "could not process $cloudapi_xml_in to $cloudapi_xml_out"

        svccfg import $cloudapi_xml_out || \
            fatal "unable to import $cloudapi_instance: $cloudapi_xml_out"
        svcadm enable "$cloudapi_instance" || \
            fatal "unable to start $cloudapi_instance"
    done

    unset IFS
}


function setup_haproxy_rsyslogd {
    #rsyslog was already set up by common setup- this will overwrite the
    # config and restart since we want haproxy to log locally.

    echo "Updating /etc/rsyslog.conf"
    mkdir -p /var/tmp/rsyslog/work
    chmod 777 /var/tmp/rsyslog/work

    cat > /etc/rsyslog.conf <<"HERE"
$MaxMessageSize 64k

$ModLoad immark
$ModLoad imsolaris
$ModLoad imudp

*.err;kern.notice;auth.notice                   /dev/sysmsg
*.err;kern.debug;daemon.notice;mail.crit        /var/adm/messages

*.alert;kern.err;daemon.err                     operator
*.alert                                         root

*.emerg                                         *

mail.debug                                      /var/log/syslog

auth.info                                       /var/log/auth.log
mail.info                                       /var/log/postfix.log

$WorkDirectory /var/tmp/rsyslog/work
$ActionQueueType Direct
$ActionQueueFileName sdcfwd
$ActionResumeRetryCount -1
$ActionQueueSaveOnShutdown on

local0.* /var/log/haproxy.log

$UDPServerAddress 127.0.0.1
$UDPServerRun 514
HERE


    svcadm restart system-log
    [[ $? -eq 0 ]] || fatal "Unable to restart rsyslog"

    logadm -w /var/log/haproxy.log -C 5 -c -s 100m
}

setup_tls_certificate

setup_cloudapi

setup_haproxy_rsyslogd

# Install Amon monitor and probes for CloudAPI
TRACE=1 /opt/smartdc/cloudapi/bin/cloudapi-amon-install

# Log rotation.
sdc_log_rotation_add amon-agent /var/svc/log/*amon-agent*.log 1g
sdc_log_rotation_add config-agent /var/svc/log/*config-agent*.log 1g
sdc_log_rotation_add registrar /var/svc/log/*registrar*.log 1g
sdc_log_rotation_add cloudapi-8081 /var/svc/log/*cloudapi-8081.log 1g
sdc_log_rotation_add cloudapi-8082 /var/svc/log/*cloudapi-8082.log 1g
sdc_log_rotation_add cloudapi-8083 /var/svc/log/*cloudapi-8083.log 1g
sdc_log_rotation_add cloudapi-8084 /var/svc/log/*cloudapi-8084.log 1g
sdc_log_rotation_setup_end

# Add metadata for cmon-agent discovery
mdata-put metricPorts 8881,8882,8883,8884

# All done, run boilerplate end-of-setup
sdc_setup_complete

exit 0
