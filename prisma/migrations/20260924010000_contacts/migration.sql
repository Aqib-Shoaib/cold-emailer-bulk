CREATE TYPE "SuppressionReason" AS ENUM ('MANUAL', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED');

CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "first_name" VARCHAR(120) NOT NULL DEFAULT '',
    "last_name" VARCHAR(120) NOT NULL DEFAULT '',
    "company" VARCHAR(160) NOT NULL DEFAULT '',
    "title" VARCHAR(160) NOT NULL DEFAULT '',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contacts_email_normalized" CHECK ("email" = lower(btrim("email")))
);

CREATE TABLE "suppressions" (
    "email" VARCHAR(320) NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "detail" VARCHAR(300) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppressions_pkey" PRIMARY KEY ("email"),
    CONSTRAINT "suppressions_email_normalized" CHECK ("email" = lower(btrim("email")))
);

CREATE TABLE "contact_lists" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "contact_lists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contact_list_members" (
    "list_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contact_list_members_pkey" PRIMARY KEY ("list_id", "contact_id")
);

CREATE TABLE "contact_imports" (
    "id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL,
    "duplicate_count" INTEGER NOT NULL,
    "invalid_count" INTEGER NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contact_imports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contacts_email_key" ON "contacts"("email");
CREATE INDEX "contacts_archived_at_idx" ON "contacts"("archived_at");
CREATE UNIQUE INDEX "contact_lists_name_key" ON "contact_lists"("name");
CREATE INDEX "contact_list_members_contact_id_idx" ON "contact_list_members"("contact_id");
CREATE INDEX "contact_imports_created_at_idx" ON "contact_imports"("created_at");

ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_list_id_fkey"
FOREIGN KEY ("list_id") REFERENCES "contact_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_contact_id_fkey"
FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_imports" ADD CONSTRAINT "contact_imports_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
