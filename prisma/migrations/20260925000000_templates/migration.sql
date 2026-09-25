CREATE TABLE "templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "text_body" TEXT NOT NULL,
    "html_body" TEXT NOT NULL,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "template_versions" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "text_body" TEXT NOT NULL,
    "html_body" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "template_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "templates_archived_at_idx" ON "templates"("archived_at");
CREATE UNIQUE INDEX "template_versions_template_id_version_key" ON "template_versions"("template_id", "version");
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_fkey"
FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
