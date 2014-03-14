#!/bin/sh
#
# Usage:
#   ./install-seed-packages-coal.sh [-o <owner_uuid>]
#
# For COAL we don't set an owner_uuid for the image creation packages, i.e.
# they are made public.
#

TOP=$(cd $(dirname $0)/ >/dev/null; pwd)

UUID1=$(uuid)
UUID2=$(uuid)
UUID3=$(uuid)
UUID4=$(uuid)
NETWORKS="[\"$(sdc-napi /networks?name=external | json -H 0.uuid)\"]"

if [[ ! -f $TOP/seed.ldif.in ]]; then
    echo "$0: fatal error: '$TOP/seed.ldif.in' does not exist" >&2
    exit 1
fi
sed -e "
    s|IN_UUID1|$UUID1|;
    s|IN_UUID2|$UUID2|;
    s|IN_UUID3|$UUID3|;
    s|IN_UUID4|$UUID4|;
    s|IN_NETWORKS|$NETWORKS|;
    /IN_OWNER_UUID/d;
    /^traits/d;
    " $TOP/seed.ldif.in >/tmp/seed-packages.ldif
