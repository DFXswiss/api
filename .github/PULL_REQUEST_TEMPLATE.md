### Release Checklist

#### Pre-Release

- [ ] Check migrations
  - No database related infos (sqldb-xxx)
  - Impact on GS (new/removed columns)
- [ ] Check for linter errors (in PR)
- [ ] Test basic user operations (on [DFX services](https://dev.app.dfx.swiss))
  - Login/logout
  - Buy/sell payment request
  - KYC page

#### Post-Release

- Test basic user operations
- Monitor application insights log
