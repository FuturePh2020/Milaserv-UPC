-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "addressAr" TEXT,
ADD COLUMN     "addressEn" TEXT,
ADD COLUMN     "branchTypeKey" TEXT,
ADD COLUMN     "deliveryCovered" BOOLEAN,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "districtManagerName" TEXT,
ADD COLUMN     "dutyPharmacist" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "mapUrl" TEXT,
ADD COLUMN     "phone2" TEXT,
ADD COLUMN     "phone3" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "storeCode" TEXT,
ADD COLUMN     "workingHours" JSONB;

-- CreateTable
CREATE TABLE "BranchType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BranchType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchType_key_key" ON "BranchType"("key");

-- CreateIndex
CREATE INDEX "Branch_region_city_idx" ON "Branch"("region", "city");

-- CreateIndex
CREATE INDEX "Branch_branchTypeKey_idx" ON "Branch"("branchTypeKey");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_branchTypeKey_fkey" FOREIGN KEY ("branchTypeKey") REFERENCES "BranchType"("key") ON DELETE SET NULL ON UPDATE CASCADE;
