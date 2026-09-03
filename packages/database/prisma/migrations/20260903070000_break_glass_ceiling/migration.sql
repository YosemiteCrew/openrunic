-- The break-glass bounds, enforced where they cannot be raced or waited out.
--
-- Expand-only. One function and one trigger; no table or column changes, and a
-- release running the previous code against this schema behaves identically
-- until it tries to exceed a bound.
--
-- WHY THIS IS NOT ONLY IN THE HANDLER
--
-- The route counts the caller's grants and refuses past the bound. That is
-- check-then-write: two requests arriving together both read nine, both pass,
-- and both insert. Sent in parallel it is not a limit at all, and the thing it
-- fails to limit is how many charts one person can hold open at once.
--
-- The advisory lock is what makes the count trustworthy rather than the count
-- itself. Without it the trigger has the same race under READ COMMITTED: two
-- transactions each see nine rows, neither sees the other's uncommitted insert,
-- and both commit. The lock is taken on (tenant, user), so declarations by
-- different people never wait on each other, and it is released when the
-- transaction ends whether it commits or not.
--
-- WHY TWO BOUNDS AND NOT ONE
--
-- The concurrent ceiling counts unexpired grants, and the caller chooses the
-- expiry. Asking for a one-minute window frees every slot a minute later, so on
-- its own the ceiling bounds nothing over an afternoon: ten charts, wait, ten
-- more, indefinitely. The rolling bound counts declarations made in the trailing
-- window whatever their expiry, which is the number a reviewer actually cares
-- about, and it is the one a caller cannot shorten their way out of.

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

-- The rolling count, which the concurrency index cannot serve: it leads with
-- `patientId`, and this question does not name one.
CREATE INDEX "BreakGlassGrant_tenantId_userId_grantedAt_idx"
  ON "BreakGlassGrant" ("tenantId", "userId", "grantedAt");

CREATE TRIGGER "BreakGlassGrant_ceiling"
  BEFORE INSERT ON "BreakGlassGrant"
  FOR EACH ROW EXECUTE FUNCTION break_glass_ceiling();
