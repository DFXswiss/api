### Release Checklist

#### Pre-Release

- [ ] Check migrations
  - No database related infos (sqldb-xxx)
  - Impact on GS (new/removed columns)
- [ ] Check for linter errors (in PR)
- [ ] Test basic user operations
  - Login/logout
  - Registration
  - Update user data
  - Create/delete payment routes

#### Post-Release

- Test basic user operations
- Monitor application insights log
