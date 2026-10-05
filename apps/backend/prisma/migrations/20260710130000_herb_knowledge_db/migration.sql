-- CreateTable
CREATE TABLE "herb_species" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,
    "nameTH" TEXT NOT NULL,
    "nameEN" TEXT,
    "scientificName" TEXT,
    "familyName" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isControlled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "herb_species_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "herb_knowledge_entries" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "herbCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "valueNumber" DOUBLE PRECISION,
    "unit" TEXT,
    "source" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "herb_knowledge_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "herb_species_uuid_key" ON "herb_species"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "herb_species_code_key" ON "herb_species"("code");

-- CreateIndex
CREATE INDEX "herb_species_isActive_idx" ON "herb_species"("isActive");

-- CreateIndex
CREATE INDEX "herb_knowledge_entries_herbCode_idx" ON "herb_knowledge_entries"("herbCode");

-- CreateIndex
CREATE INDEX "herb_knowledge_entries_category_idx" ON "herb_knowledge_entries"("category");

-- CreateIndex
CREATE INDEX "herb_knowledge_entries_herbCode_category_idx" ON "herb_knowledge_entries"("herbCode", "category");

-- AddForeignKey
ALTER TABLE "herb_knowledge_entries" ADD CONSTRAINT "herb_knowledge_entries_herbCode_fkey" FOREIGN KEY ("herbCode") REFERENCES "herb_species"("code") ON DELETE CASCADE ON UPDATE CASCADE;
