-- Click and form events can be detected by their own Google Tag Manager tag instead of the pixel.
-- Additive: every existing event keeps being detected by the pixel (MANUAL).
-- AlterTable
ALTER TABLE "event_definitions" ADD COLUMN "install" "InstallMethod" NOT NULL DEFAULT 'MANUAL';
