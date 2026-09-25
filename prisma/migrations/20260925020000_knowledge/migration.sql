CREATE TYPE "KnowledgeSourceType" AS ENUM ('PASTED_TEXT', 'PDF', 'WORD', 'TEXT_FILE');
CREATE TYPE "KnowledgeExtractionStatus" AS ENUM ('READY', 'FAILED');

CREATE TABLE "knowledge_sources" (
  "id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "type" "KnowledgeSourceType" NOT NULL,
  "file_name" VARCHAR(255) NOT NULL DEFAULT '',
  "mime_type" VARCHAR(120) NOT NULL DEFAULT '',
  "original_content" BYTEA,
  "extracted_text" TEXT NOT NULL,
  "extraction_status" "KnowledgeExtractionStatus" NOT NULL DEFAULT 'READY',
  "extraction_error" VARCHAR(500) NOT NULL DEFAULT '',
  "processed_at" TIMESTAMPTZ(3),
  "archived_at" TIMESTAMPTZ(3),
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_chunks" (
  "id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_sources_archived_at_extraction_status_idx" ON "knowledge_sources"("archived_at", "extraction_status");
CREATE UNIQUE INDEX "knowledge_chunks_source_id_ordinal_key" ON "knowledge_chunks"("source_id", "ordinal");
CREATE INDEX "knowledge_chunks_search_idx" ON "knowledge_chunks" USING GIN (to_tsvector('english', "content"));

ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
