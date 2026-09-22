ALTER TABLE "Message" ADD COLUMN "patientId" UUID;

UPDATE "Message" AS message
SET "patientId" = thread."patientId"
FROM "MessageThread" AS thread
WHERE message."threadId" = thread."id";

ALTER TABLE "Message"
ADD CONSTRAINT "Message_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Message_tenantId_patientId_sentAt_idx"
ON "Message"("tenantId", "patientId", "sentAt");

ALTER TABLE "Statement"
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
