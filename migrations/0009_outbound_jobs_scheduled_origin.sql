-- Track whether an outbound_jobs row was created by the user-facing
-- scheduled-send path. The dispatcher emits a `scheduled` flag in
-- `outbound.send.completed` so the observability SLO split
-- (scheduled vs immediate) is sourced from the outbox row, not from
-- a transient messages.status field that gets overwritten in the
-- same batch.
ALTER TABLE outbound_jobs ADD COLUMN created_via_schedule INTEGER NOT NULL DEFAULT 0 CHECK (created_via_schedule IN (0, 1));
