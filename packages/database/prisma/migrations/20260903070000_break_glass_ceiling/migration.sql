-- The break-glass ceiling, enforced where it cannot be raced.
--
-- Expand-only. One function and one trigger; no table or column changes, and a
-- release running the previous code against this schema behaves identically
-- until it tries to take an eleventh concurrent grant.
--
-- WHY THIS IS NOT ONLY IN THE HANDLER
--
-- The route counts the caller's unexpired grants and refuses past ten. That is
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

CREATE OR REPLACE FUNCTION break_glass_ceiling() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  -- Kept in step with MAX_CONCURRENT_GRANTS in apps/api/src/routes/patients.ts.
  -- Two places, because the handler's job is a readable refusal and this one's
  -- is to be true; `routes.patients.test.ts` asserts the handler's number.
  ceiling CONSTANT integer := 10;
  held integer;
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

  RETURN NEW;
END;
$$;

CREATE TRIGGER "BreakGlassGrant_ceiling"
  BEFORE INSERT ON "BreakGlassGrant"
  FOR EACH ROW EXECUTE FUNCTION break_glass_ceiling();
