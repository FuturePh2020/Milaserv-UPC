-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "DrugItemType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DrugItemType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceCompany" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InsuranceCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Drug" (
    "id" TEXT NOT NULL,
    "materialNo" TEXT NOT NULL,
    "oldMaterialNo" TEXT,
    "ean" TEXT,
    "gtin" TEXT,
    "sfdaCode" TEXT,
    "coded" BOOLEAN NOT NULL DEFAULT false,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "brand" TEXT,
    "division" TEXT,
    "category" TEXT,
    "subCategory" TEXT,
    "className" TEXT,
    "subClassName" TEXT,
    "price" DECIMAL(12,2),
    "priceWithTax" DECIMAL(12,2),
    "itemTypeKey" TEXT,
    "raqeeb" BOOLEAN NOT NULL DEFAULT false,
    "acuteChronic" TEXT,
    "activeIngredient" TEXT,
    "usage" TEXT,
    "offers" TEXT,
    "note" TEXT,
    "availability" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Drug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugAlternative" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "altMaterialNo" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DrugAlternative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugCrossSell" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "materialNo" TEXT NOT NULL,

    CONSTRAINT "DrugCrossSell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugCoverage" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "companyKey" TEXT NOT NULL,
    "covered" BOOLEAN NOT NULL,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugChangeRequest" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "patch" JSONB NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "DrugChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DrugItemType_key_key" ON "DrugItemType"("key");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceCompany_key_key" ON "InsuranceCompany"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Drug_materialNo_key" ON "Drug"("materialNo");

-- CreateIndex
CREATE INDEX "Drug_nameEn_idx" ON "Drug"("nameEn");

-- CreateIndex
CREATE INDEX "Drug_nameAr_idx" ON "Drug"("nameAr");

-- CreateIndex
CREATE INDEX "Drug_brand_idx" ON "Drug"("brand");

-- CreateIndex
CREATE UNIQUE INDEX "DrugAlternative_drugId_altMaterialNo_key" ON "DrugAlternative"("drugId", "altMaterialNo");

-- CreateIndex
CREATE UNIQUE INDEX "DrugCrossSell_drugId_materialNo_key" ON "DrugCrossSell"("drugId", "materialNo");

-- CreateIndex
CREATE INDEX "DrugCoverage_companyKey_covered_idx" ON "DrugCoverage"("companyKey", "covered");

-- CreateIndex
CREATE UNIQUE INDEX "DrugCoverage_drugId_companyKey_key" ON "DrugCoverage"("drugId", "companyKey");

-- CreateIndex
CREATE INDEX "DrugChangeRequest_status_createdAt_idx" ON "DrugChangeRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Drug" ADD CONSTRAINT "Drug_itemTypeKey_fkey" FOREIGN KEY ("itemTypeKey") REFERENCES "DrugItemType"("key") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugAlternative" ADD CONSTRAINT "DrugAlternative_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugCrossSell" ADD CONSTRAINT "DrugCrossSell_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugCoverage" ADD CONSTRAINT "DrugCoverage_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugCoverage" ADD CONSTRAINT "DrugCoverage_companyKey_fkey" FOREIGN KEY ("companyKey") REFERENCES "InsuranceCompany"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugChangeRequest" ADD CONSTRAINT "DrugChangeRequest_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;
