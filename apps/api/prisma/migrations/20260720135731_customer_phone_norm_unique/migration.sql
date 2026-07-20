-- DropIndex
DROP INDEX "Customer_phoneNorm_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phoneNorm_key" ON "Customer"("phoneNorm");
