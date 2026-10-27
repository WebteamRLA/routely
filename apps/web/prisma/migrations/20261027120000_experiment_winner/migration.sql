-- CreateEnum
CREATE TYPE "WinnerBasis" AS ENUM ('RECOMMENDED', 'MANUAL');

-- AlterEnum
ALTER TYPE "ExperimentActivityType" ADD VALUE 'WINNER_CHOSEN';

-- AlterTable
ALTER TABLE "experiments" ADD COLUMN     "winnerBasis" "WinnerBasis",
ADD COLUMN     "winnerChosenAt" TIMESTAMP(3),
ADD COLUMN     "winnerChosenById" TEXT,
ADD COLUMN     "winnerVariantId" TEXT;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_winnerVariantId_fkey" FOREIGN KEY ("winnerVariantId") REFERENCES "experiment_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_winnerChosenById_fkey" FOREIGN KEY ("winnerChosenById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

