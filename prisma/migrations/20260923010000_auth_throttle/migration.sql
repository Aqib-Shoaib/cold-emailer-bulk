-- Login throttles are database-backed so restarts cannot bypass them.
CREATE TABLE "auth_throttles" (
    "key" CHAR(64) NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "reset_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_throttles_pkey" PRIMARY KEY ("key")
);
