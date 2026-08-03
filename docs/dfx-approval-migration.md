# Replacing the eight DfxApproval GSheets

## Scope

The API workflow replaces exactly the eight minute-interval personal onboarding projects:

1. DfxApproval approval
2. DfxApproval risk flags
3. `GwGFileCover`
4. `IdentificationForm`
5. `CustomerProfile`
6. `RiskProfile`
7. `FormA`
8. `DfxNameCheck`

`IdentReport` and `PersonalNameCheck` keep being produced by their existing KYC processes. They are
part of the approval gate, but they are not among the eight sheets being replaced. Organizations are
not part of this personal-sheet migration.

## How the API handles a case

`DfxApprovalWorkflowService` picks up at most 50 of the oldest personal cases with
`DfxApproval = ManualReview` and `kycLevel >= 40` every minute. The process is off by default and is
only activated with `KYC_DFX_APPROVAL_WORKFLOW_ENABLED=true`.

Per case:

1. A PostgreSQL advisory lock prevents parallel processing across API instances.
2. Empty personal risk fields are initialised with the previous GSheet values only after a completed
   NameCheck that is at most 90 days old: `pep=false`, `highRisk=false`, `complexOrgStructure=false`
   and `depositLimit=100000`. As in the approval sheet, `amlAccountType` is only set to
   `natural person` for the DfxApproval case itself. Existing values are never overwritten, and every
   change is recorded in `kyc_log`.
3. The six missing PDF records are written with `pdf-lib` onto copies of the productive Google Sheet
   PDF templates and stored idempotently in WORM storage under a unique `generationKey`. A `kyc_file`
   is marked valid only after a successful upload. The text is set in an embedded Unicode font
   (Liberation Sans, metrically compatible with Arial/Helvetica) so that names, streets and employers
   outside Latin-1 do not abort the document; characters without a glyph are substituted and logged
   instead of discarding the document.
4. The server-side gate checks every business precondition and all eight document types.
5. Only a fully unblocked case is set to `DfxApproval = Completed`, `kycLevel = 50` and
   `kycStatus = Completed` in one database transaction. Step and KYC logs are written in the same
   transaction; the notification follows after the commit.

The six documents keep their mutually independent GSheet selection rules:

- `GwGFileCover`, `IdentificationForm` and `DfxNameCheck`: DfxApproval in `InternalReview` or
  `ManualReview`; the specific checks on personal account, name, nationality and merge status apply
  per document.
- `CustomerProfile`: completed FinancialData for personal accounts with `30 <= kycLevel < 50`.
- `RiskProfile` and `FormA`: DFX personal accounts with `30 <= kycLevel < 50`; RiskProfile
  additionally requires `highRisk=false` and a FATF-enabled country of residence. These two documents
  belong to the account, not to a KYC step: they are also generated for accounts that have neither a
  `DfxApproval` nor a `FinancialData` step, which is what the productive Sheet covers. The productive
  legacy exceptions live in the `dfxApprovalDocumentExclusions` setting (a JSON array of `user_data`
  IDs) instead of the source tree; without that setting the exclusion list is empty.

A document can therefore be produced even when another document or a later approval precondition is
still missing. Incomplete or invalid JSON data, missing NameCheck data and storage errors are logged
per document; the other documents of the same case continue. Empty compliance values are never
interpreted as `false`.

## Automatic approval gate

Automatic approval requires:

- personal account, DfxApproval `ManualReview`, `kycLevel` of at least 40
- `verifiedName`, `kycHash`, first name, date of birth and e-mail
- `complexOrgStructure = false`, `highRisk = false`, `pep = false`
- a permitted user and KYC status
- an enabled country without manual country review; Brazil stays excluded
- a permitted identification document type and a present document number
- a present nationality; for a disabled nationality a completed residence permit
- no open sanctioned NameCheck
- valid files for `GwGFileCover`, `IdentReport`, `IdentificationForm`, `CustomerProfile`,
  `RiskProfile`, `FormA`, `DfxNameCheck` and `PersonalNameCheck`

Whenever the gate refuses, the blocking reasons are logged as
`DfxApproval step <id> not ready: <blockers>`.

This migration requires no change in `DFXswiss/services` and no additional manual endpoint.
Approval, document generation, locking, idempotency and auditing live entirely in the API.

## Behaviour carried over deliberately

Three properties of the Sheet process are reproduced as they are, because this migration replaces the
process without changing the rules it applies:

- **Compliance defaults on approval.** `complexOrgStructure`, `highRisk`, `depositLimit` and
  `amlAccountType` are set to the approval defaults, even where an account carried a different value
  before. The previous values are written to `kyc_log` in the same transaction, so any earlier
  decision stays reconstructible. Changing this would change the outcome of the approval, not just
  its implementation.
- **RiskProfile outside a FATF-enabled country.** The document is only generated for a FATF-enabled
  country of residence, while the gate requires it for every case. An account outside such a country
  therefore never completes automatically and stays with Compliance - exactly as under the Sheet
  process. A test pins generation condition and gate requirement together so neither side can be
  changed alone.
- **Documents already produced by the Sheets are not regenerated.** A subtype that exists and is
  valid is skipped, whatever produced it.

## Residual risk

The selection rules of the six document sheets are documented in the audit package rather than taken
from their source: Google refuses the script export of those six projects with `403`, so only the two
readable projects (approval, risk flags) have byte-exact code snapshots. The rules were reconstructed
from the workbook exports. Before the cutover, compare the candidate sets of at least one document
sheet against the productive sheet - the API-side queries are in
`DfxApprovalWorkflowService.generatePending*`.

## Productive cutover

The order is binding so that GSheets and API never write in parallel:

1. Deploy the API including the database migration while `KYC_DFX_APPROVAL_WORKFLOW_ENABLED=false`
   stays in place. In the same step, fill the `dfxApprovalDocumentExclusions` setting with the
   productive legacy exceptions — without it the workflow also generates documents for those
   accounts.
2. Verify the six PDF subtypes and the automatic approval with a test case in the disabled or
   controlled staging setup.
3. Disable all eight minute-interval triggers on the operator account, but do not delete them yet, so
   that a rollback stays quick.
4. Confirm for at least three minutes that none of the eight projects runs any more.
5. Set `KYC_DFX_APPROVAL_WORKFLOW_ENABLED=true` and restart the API in a controlled way.
6. Watch throughput, the oldest waiting case, new `kyc_file` subtypes, step logs and error logs over
   several minutes.
7. Remove the eight old triggers for good only after a stable observation period.

`Process.KYC_DFX_APPROVAL` also remains available as a fast kill switch through the existing
`disabledProcesses` setting.

## Rollback

1. Set `KYC_DFX_APPROVAL_WORKFLOW_ENABLED=false` or disable `KycDfxApproval` through
   `disabledProcesses`.
2. Make sure no API execution is still running.
3. Re-enable the eight old triggers and watch their executions and the backlog.

The schema migration is not rolled back: `generationKey` is nullable for existing files and does not
affect the old process. Documents already generated correctly by the API stay valid KYC records; as
before, the old sheets have to skip subtypes that already exist.

## Operational monitoring

Alerts are needed for:

- a growing number of `DfxApproval = ManualReview` with `kycLevel = 40`
- an increasing age of the oldest waiting case
- missing or invalid document subtypes
- repeated `DfxApproval workflow failed` logs
- recurring `DfxApproval step <id> not ready` logs with the same blocker: they name the reason a case
  is not being approved
- storage, PDF, JSON or NameCheck errors

A backlog of zero is only a snapshot. Throughput and case age are what matter.
