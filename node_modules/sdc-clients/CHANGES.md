# sdc-clients Changelog

## sdc-clients 7.0.3

- [Backward incompatible change] entire repo ported to restify1.0. Mapi
  client now only speaks to /machines.  Code cut by order of magnitude.

## sdc-clients 7.0.2

- [Backword incompatible change.] `Amon.putMonitor` and `Amon.putProbe`
  methods have changed to take the monitor/probe *name* field as a
  separate argument.


## sdc-clients 7.0.1

- CAPI-104: Fix `new UFDS(...)` handling for erroneous credential options.
  Ensure no 'ready' event after an 'error' event for error to bind.

  [Backward incompatible change.] Change the 'ready' event from `UFDS` to
  not include the "bound" value: the 'ready' event means the bind was
  successful.


## sdc-clients 7.0.0

- PROV-1371: Add MAPI.{listMachines,countMachines,getMachine,getMachineByAlias}
  methods. This is a start at methods for MAPI's new "/machines/..."
  endpoints.

  The following MAPI client methods are now deprecated: countZones,
  listZones, getZoneByAlias, getZone, countVirtualMachines, listVMs,
  getVirtualMachine, getVMByAlias.

  Note that these new client methods are closer to MAPI's actual
  behaviour than, e.g. `MAPI.getZones`. For example, specifying an owner
  uuid is optional, options match the MAPI names, destroyed machines are
  returned.

  [Backward incompatible change.] Also adds an `errorFormatter` option to the
  MAPI constructor for translating MAPI error responses. A
  `MAPI.restifyErrorFormatter` is provided to get some Cavage-approved (TM)
  translation -- which was the old default behaviour:

        var client = new MAPI({
          ...,
          errorFormatter: MAPI.restifyErrorFormatter
        });

- PROV-1370: MAPI.{count,list}{Zones,VMs}: drop 'all*' options. Just always
  set 'X-Joyent-Ignore-Provisioning-State' header.

- PROV-1369: `count` in callback from `MAPI.countVMs` and `MAPI.countZones` 


## sdc-clients 6.1.0

This version stuck around for a long time, from SDC 6.1 through all SDC 6.5 releases.
Initially it was set to match the SDC release version, but Mark has been shown
the error of his ways. We'll start fresh at version 7.0.0.
