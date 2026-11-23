-- The status system was removed (2026-11-06, docs/FORK_CHANGES.md "Statuses
-- removed"): its tables and the account right go, also in databases restored from
-- an export made before.
DROP TABLE IF EXISTS userdata.status_change;
DROP TABLE IF EXISTS userdata.feature_status;
ALTER TABLE userdata.app_user DROP COLUMN IF EXISTS can_set_statuses;
