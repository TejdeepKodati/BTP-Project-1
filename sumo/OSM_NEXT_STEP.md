# OSM network expansion (next step)

The current Road network milestone deliberately uses a small controlled SUMO
network so the four interaction categories can be reproduced and debugged.
SUMO can import OpenStreetMap data natively with `netconvert --osm-files`, and
its OSM importer can use bicycle access tags and bicycle infrastructure.

A future real-network workflow is:

```text
OpenStreetMap extract
        -> netconvert / osmBuild
        -> SUMO .net.xml
        -> lane/permission review in netedit
        -> traffic demand / routes
        -> TraCI interaction measurement
```

For the meeting, describe this as the next network-expansion step rather than
claiming that the current controlled corridor is an OSM-derived street map.
