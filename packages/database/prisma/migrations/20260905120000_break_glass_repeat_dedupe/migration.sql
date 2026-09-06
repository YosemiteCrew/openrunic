-- Repeat break-glass declarations, made atomic.
--
-- Expand-only. One function body is replaced; no table, column, index or
-- trigger changes, and the trigger stays bound to the function across the
-- replacement. A release running the previous code against this schema behaves
-- identically except that a second concurrent declaration for a chart it
-- already holds open is refused instead of filing a duplicate row.
--
-- WHAT WAS WRONG
--
-- The route documents a repeat declaration as idempotent: re-declaring for a
-- chart already open returns the grant already held rather than filing another.
-- It implemented that by reading the caller's unexpired grants and returning
-- the one naming this patient, then creating a row when it found none. That is
-- check-then-write across two round trips, and nothing held between them.
--
-- The ceiling trigger below already serialises inserts on (tenant, user), but
-- it counts rather than dedupes, so it never noticed the second row. Two
-- concurrent declarations for the same chart therefore both read no existing
-- grant and both committed, and the documented idempotency was true only for
-- requests that happened not to overlap. Well below the ceiling that is two
-- rows where the route promised one, which is noise in the record this table
-- exists to make readable. At the ceiling it is worse: the second request took
-- the last slot it should not have needed, and the one after it was refused
-- with a limit error where the route documents a 200.
--
-- WHY HERE AND NOT IN THE HANDLER
--
-- The handler cannot serialise this. It reads through a repository and creates
-- through another call, and there is no lock it can hold across the two that
-- the database is not already holding for the ceiling. The advisory lock this
-- function takes is exactly the right one - it is per (tenant, user), which is
-- the same key a repeat declaration is scoped by - and taking the existence
-- check under it costs nothing, because the lock is already held by the time
-- this function runs and is released when the transaction ends either way.
--
-- The route recovers from the refusal by re-reading and returning the grant
-- that won, so the caller still sees the documented 200. It does that on any
-- failed create rather than by matching an error code: a grant that was absent
-- when the handler looked and present a moment later can only be the race this
-- refusal describes, since the handler returns before creating in every other
-- case.

CREATE OR REPLACE FUNCTION break_glass_ceiling() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  -- Kept in step with MAX_CONCURRENT_GRANTS, MAX_GRANTS_PER_WINDOW and
  -- GRANT_WINDOW_HOURS in apps/api/src/routes/patients.ts. Two places, because
  -- the handler's job is a readable refusal and this one's is to be true;
  -- `routes.patients.test.ts` asserts the handler's numbers.
  ceiling  CONSTANT integer  := 10;
  per_window CONSTANT integer := 20;
  window_len CONSTANT interval := interval '24 hours';
  held integer;
  made integer;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(NEW."tenantId"::text || ':' || NEW."userId"::text)
  );

  -- Before either bound, and in that order deliberately: a repeat declaration
  -- files no row, so it must not be refused by a ceiling it does not consume.
  -- The handler returns the held grant before it reaches its own ceiling check
  -- for the same reason, and the two orders have to agree or the uncontended
  -- path and the contended one answer differently.
  --
  -- Served by "BreakGlassGrant_tenantId_userId_patientId_expiresAt_idx", which
  -- the first migration created for the read path and which answers exactly
  -- this question.
  IF EXISTS (
    SELECT 1
      FROM "BreakGlassGrant"
     WHERE "tenantId" = NEW."tenantId"
       AND "userId" = NEW."userId"
       AND "patientId" = NEW."patientId"
       AND "expiresAt" > NEW."grantedAt"
  ) THEN
    -- `unique_violation` because that is what this is: at most one unexpired
    -- grant per (tenant, user, patient). It cannot be spelled as a unique index
    -- - "unexpired" is a comparison against the row's own clock, and a partial
    -- index predicate has to be immutable - so the constraint lives here, under
    -- the lock that makes it true.
    RAISE EXCEPTION
      'break-glass grant already held for this chart'
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT count(*) INTO held
    FROM "BreakGlassGrant"
   WHERE "tenantId" = NEW."tenantId"
     AND "userId" = NEW."userId"
     AND "expiresAt" > NEW."grantedAt";

  IF held >= ceiling THEN
    RAISE EXCEPTION
      'break-glass ceiling reached: % concurrent grants', held
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO made
    FROM "BreakGlassGrant"
   WHERE "tenantId" = NEW."tenantId"
     AND "userId" = NEW."userId"
     AND "grantedAt" > NEW."grantedAt" - window_len;

  IF made >= per_window THEN
    RAISE EXCEPTION
      'break-glass rolling limit reached: % grants in the window', made
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
