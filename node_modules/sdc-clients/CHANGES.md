# sdc-clients Changelog

- HEAD-912: Add MAPI.{getBootParams,createNic} for the benefit of dhcpd.

## sdc-clients 7.0.0

- Port most clients to restify 1.0
- PROV-1370: MAPI.{count,list}{Zones,VMs}: drop 'all*' options. Just always set 'X-Joyent-Ignore-Provisioning-State' header.
- PROV-1369: `count` in callback from `MAPI.countVMs` and `MAPI.countZones` 


## sdc-clients 6.1.0

This version stuck around for a long time, from SDC 6.1 through all SDC 6.5 releases.
Initially it was set to match the SDC release version, but Mark has been shown
the error of his ways. We'll start fresh at version 7.0.0.

