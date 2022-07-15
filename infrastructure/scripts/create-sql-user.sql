-- master
CREATE LOGIN <dfx_test WITH PASSWORD = 'abc1234'

-- db
SELECT *
FROM sysusers

-- create role
CREATE ROLE dfx_db_test

DENY ALL
	ON dbo.asset
TO dfx_db_test

GRANT INSERT, SELECT, UPDATE, DELETE
	ON dbo.asset
TO dfx_db_test

DENY UPDATE (sellable)
	ON dbo.asset
TO dfx_db_test

DENY SELECT (sellable)
	ON dbo.asset
TO dfx_db_test

GRANT UPDATE (buyable)
	dbo.asset
TO dfx_db_test

-- create user
CREATE USER dfx_test FOR LOGIN dfx_test

ALTER ROLE dfx_db_test
ADD MEMBER dfx_test


-- drop
ALTER ROLE dfx_db_test
DROP MEMBER dfx_test

DROP USER dfx_test

DROP ROLE dfx_db_test