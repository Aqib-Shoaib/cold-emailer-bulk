CREATE TABLE "password_resets" (
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("user_id")
);

CREATE INDEX "password_resets_expires_at_idx" ON "password_resets"("expires_at");

ALTER TABLE "password_resets"
ADD CONSTRAINT "password_resets_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
