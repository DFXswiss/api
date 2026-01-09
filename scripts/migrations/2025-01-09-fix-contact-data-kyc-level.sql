-- Migration: Fix kycLevel for users with completed CONTACT_DATA but level < 10
-- Date: 2025-01-09
-- Issue: PR #2903 - Mail Login KYC Level Fix
-- Database: SQL Server (Azure)
--
-- Problem: 4 active users have CONTACT_DATA completed but kycLevel = 0
-- This is a historical data inconsistency that should be fixed.
--
-- Affected users (as of 2025-01-09):
--   ID 257036, 229330, 1158, 1058
--
-- INSTRUCTIONS:
--   1. Run Step 1 (DRY RUN) to verify affected users
--   2. Run Step 2 (UPDATE) in a transaction
--   3. Verify row count = 4
--   4. Run Step 3 to verify the fix
--   5. COMMIT or ROLLBACK based on verification

-- ============================================================================
-- Step 1: DRY RUN - Verify affected users BEFORE running the update
-- Expected: 4 rows (IDs: 257036, 229330, 1158, 1058)
-- ============================================================================
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
ORDER BY ud.id DESC;

-- ============================================================================
-- Step 2: UPDATE - Run this in a transaction!
-- IMPORTANT: Uncomment the UPDATE statement before running
-- ============================================================================

-- BEGIN TRANSACTION;

-- UPDATE ud
-- SET ud.kycLevel = 10, ud.updated = GETDATE()
-- FROM user_data ud
-- INNER JOIN kyc_step ks ON ks.userDataId = ud.id
-- WHERE ks.name = 'ContactData'
--   AND ks.status = 'Completed'
--   AND ud.kycLevel >= 0
--   AND ud.kycLevel < 10
--   AND ud.status = 'Active';

-- Check: Should show "(4 rows affected)"
-- If more or less than 4 rows: ROLLBACK immediately!

-- ============================================================================
-- Step 3: VERIFY - Check that the update was successful
-- Expected: All 4 users should now have kycLevel = 10
-- ============================================================================

-- SELECT
--     ud.id,
--     ud.kycLevel,
--     ud.status,
--     ud.updated
-- FROM user_data ud
-- WHERE ud.id IN (257036, 229330, 1158, 1058)
-- ORDER BY ud.id;

-- ============================================================================
-- Step 4: COMMIT or ROLLBACK
-- ============================================================================

-- If verification passed (4 rows, all with kycLevel = 10):
-- COMMIT;

-- If something went wrong:
-- ROLLBACK;
