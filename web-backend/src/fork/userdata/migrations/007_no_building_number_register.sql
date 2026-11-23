-- Building numbers are worked out when asked for, not stored (building_numbers/
-- areas.py, the owner's choice): the register goes. The numbers stay the same for
-- the same background map (worked out in the same order).
DROP TABLE IF EXISTS userdata.building_ref;
DROP TABLE IF EXISTS userdata.building_sliver;
DROP TABLE IF EXISTS userdata.area_numbered;
