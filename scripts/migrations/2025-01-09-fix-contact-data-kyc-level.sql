-- Migration: Fix kycLevel for users with completed CONTACT_DATA but level < 10
-- Date: 2025-01-09
-- Issue: PR #2903 - Mail Login KYC Level Fix
--
-- Problem: 4 active users have CONTACT_DATA completed but kycLevel = 0
-- This is a historical data inconsistency that should be fixed.
--
-- Affected users (as of 2025-01-09):
--   ID 257036, 229330, 1158, 1058

-- Step 1: Verify affected users (DRY RUN)
-- Run this first to see what will be updated:
/*
SELECT
    ud.id,
    ud.kycLevel,
    ud.status,
    ks.status as stepStatus,
    ks.created as stepCreated
FROM user_data ud
INNER JOIN kyc_step ks ON ks.userDataId = ud.id
WHERE ks.name = 'ContactData'
  AND ks.status = 'Completed'
  AND ud.kycLevel >= 0
  AND ud.kycLevel < 10
  AND ud.status = 'Active'
ORDER BY ud.id DESC
*/

-- Step 2: Update kycLevel to 10 for affected users
UPDATE user_data
SET kycLevel = 10, updated = GETDATE()
WHERE id IN (
    SELECT ud.id
    FROM user_data ud
    INNER JOIN kyc_step ks ON ks.userDataId = ud.id
    WHERE ks.name = 'ContactData'
      AND ks.status = 'Completed'
      AND ud.kycLevel >= 0
      AND ud.kycLevel < 10
      AND ud.status = 'Active'
)

-- Step 3: Verify the fix
/*
SELECT
    ud.id,
    ud.kycLevel,
    ud.status
FROM user_data ud
WHERE ud.id IN (257036, 229330, 1158, 1058)
*/
