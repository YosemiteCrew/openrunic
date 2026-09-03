-- Who handed out a task, recorded so chart authorisation can read it.
--
-- Expand-only. One nullable column and one index; a release running the
-- previous code against this schema writes NULL and behaves as it did.
--
-- WHY A COLUMN AND NOT A RULE IN THE HANDLER
--
-- The care-relationship check treats an assigned task as evidence that somebody
-- involved this reader in this patient's care. Without provenance that is a
-- statement the reader can write for themselves: any account holding
-- `task.write` could file a task naming an arbitrary in-tenant patient, put its
-- own id in `assigneeUserId`, and read the chart. The row is the evidence, so
-- the row has to say who produced it.
--
-- NULL is not a gap. It means no person assigned the task, which is what the
-- routing engine's own tasks look like: those come from a domain event, not
-- from a request, and they are trusted for the same reason the event is.
ALTER TABLE "Task" ADD COLUMN "assignedById" UUID;

-- RESTRICT, like every other actor column on this table: deleting the person
-- who handed out the work must not be the thing that rewrites who did.
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The authorisation lookup: this patient's tasks held by this reader, with who
-- assigned each one.
CREATE INDEX "Task_tenantId_patientId_assigneeUserId_assignedById_idx"
  ON "Task" ("tenantId", "patientId", "assigneeUserId", "assignedById");
