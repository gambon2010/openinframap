-- Building numbers per neighbourhood, again: a commune whose IRIS are all in one grand
-- quartier now has its IRIS as neighbourhoods (Molsheim was numbered whole, "MLS-NOR",
-- from the first IRIS's name). Its areas' codes changed: numbered again from scratch
-- (nothing shared them yet).
TRUNCATE userdata.building_ref;
TRUNCATE userdata.building_sliver;
TRUNCATE userdata.area_numbered;
