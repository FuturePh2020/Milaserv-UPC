-- CreateEnum
CREATE TYPE "MetricAggregation" AS ENUM ('SUM', 'AVG');

-- CreateEnum
CREATE TYPE "MetricSource" AS ENUM ('YEASTAR', 'TICKETING');

-- CreateEnum
CREATE TYPE "PerfScopeType" AS ENUM ('USER', 'TEAM');

-- CreateEnum
CREATE TYPE "TargetPeriod" AS ENUM ('DAILY', 'MONTHLY', 'YEARLY');

-- CreateTable
CREATE TABLE "PerformanceMetricDef" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "aggregation" "MetricAggregation" NOT NULL,
    "source" "MetricSource" NOT NULL,
    "higherIsBetter" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PerformanceMetricDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricValue" (
    "id" TEXT NOT NULL,
    "metricDate" DATE NOT NULL,
    "scopeType" "PerfScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceTarget" (
    "id" TEXT NOT NULL,
    "scopeType" "PerfScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "period" "TargetPeriod" NOT NULL,
    "targetValue" DECIMAL(14,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceMetricDef_key_key" ON "PerformanceMetricDef"("key");

-- CreateIndex
CREATE INDEX "MetricValue_scopeType_scopeId_metricDate_idx" ON "MetricValue"("scopeType", "scopeId", "metricDate");

-- CreateIndex
CREATE UNIQUE INDEX "MetricValue_metricDate_scopeType_scopeId_metricKey_key" ON "MetricValue"("metricDate", "scopeType", "scopeId", "metricKey");

-- CreateIndex
CREATE INDEX "PerformanceTarget_scopeType_scopeId_idx" ON "PerformanceTarget"("scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceTarget_scopeType_scopeId_metricKey_period_key" ON "PerformanceTarget"("scopeType", "scopeId", "metricKey", "period");

-- AddForeignKey
ALTER TABLE "MetricValue" ADD CONSTRAINT "MetricValue_metricKey_fkey" FOREIGN KEY ("metricKey") REFERENCES "PerformanceMetricDef"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceTarget" ADD CONSTRAINT "PerformanceTarget_metricKey_fkey" FOREIGN KEY ("metricKey") REFERENCES "PerformanceMetricDef"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
