import { createCustomCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { AccountType } from '../../../user/models/user-data/account-type.enum';
import { createCustomUserData } from '../../../user/models/user-data/__mocks__/user-data.entity.mock';
import { KycLevel, KycStatus, UserDataStatus } from '../../../user/models/user-data/user-data.enum';
import { FileSubType, FileType } from '../../dto/kyc-file.dto';
import { DfxApprovalBlocker } from '../../dto/output/dfx-approval-status.dto';
import { KycFile } from '../../entities/kyc-file.entity';
import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepName } from '../../enums/kyc-step-name.enum';
import { ReviewStatus } from '../../enums/review-status.enum';
import { DFX_APPROVAL_REQUIRED_DOCUMENTS, DfxApprovalCheckService } from '../dfx-approval-check.service';

describe('DfxApprovalCheckService', () => {
  const service = new DfxApprovalCheckService();

  function eligibleInput(): { userData: ReturnType<typeof createCustomUserData>; step: KycStep; files: KycFile[] } {
    const country = createCustomCountry({
      symbol: 'CH',
      dfxEnable: true,
      manualReviewRequired: false,
      nationalityEnable: true,
      enabledKycDocuments: 'PASSPORT;ID_CARD',
    });
    const step = Object.assign(new KycStep(), {
      id: 11,
      name: KycStepName.DFX_APPROVAL,
      status: ReviewStatus.MANUAL_REVIEW,
      sequenceNumber: 1,
    });
    const userData = createCustomUserData({
      id: 7,
      accountType: AccountType.PERSONAL,
      status: UserDataStatus.ACTIVE,
      kycStatus: KycStatus.NA,
      kycLevel: KycLevel.LEVEL_40,
      verifiedName: 'Test User',
      firstname: 'Test',
      surname: 'User',
      birthday: new Date('1990-01-01'),
      mail: 'test@example.com',
      kycHash: 'HASH',
      complexOrgStructure: false,
      highRisk: false,
      pep: false,
      country,
      nationality: country,
      identDocumentId: 'DOC-1',
      identDocumentType: 'PASSPORT',
      kycSteps: [step],
    });
    step.userData = userData;
    const files = DFX_APPROVAL_REQUIRED_DOCUMENTS.map((subType, index) =>
      Object.assign(new KycFile(), { id: index + 1, type: FileType.USER_NOTES, subType, valid: true }),
    );
    return { userData, step, files };
  }

  it('accepts a personal onboarding only when every prerequisite and document is present', () => {
    const { userData, step, files } = eligibleInput();

    expect(service.evaluatePersonal(userData, step, files, false)).toEqual({ ready: true, blockers: [] });
  });

  it('fails closed for unset risk data and missing documents', () => {
    const { userData, step, files } = eligibleInput();
    userData.pep = undefined;
    userData.highRisk = undefined;
    const withoutRiskProfile = files.filter((file) => file.subType !== FileSubType.RISK_PROFILE);

    const result = service.evaluatePersonal(userData, step, withoutRiskProfile, false);

    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        { code: DfxApprovalBlocker.RISK_DATA_PENDING },
        { code: DfxApprovalBlocker.MISSING_DOCUMENT, documentSubType: FileSubType.RISK_PROFILE },
      ]),
    );
  });

  it('never auto-approves a manual country, an open name check or a high-risk user', () => {
    const { userData, step, files } = eligibleInput();
    userData.country.manualReviewRequired = true;
    userData.highRisk = true;

    const result = service.evaluatePersonal(userData, step, files, true);

    expect(result.ready).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        DfxApprovalBlocker.COUNTRY_REQUIRES_MANUAL_REVIEW,
        DfxApprovalBlocker.HIGH_RISK,
        DfxApprovalBlocker.OPEN_NAME_CHECK,
      ]),
    );
  });

  it('requires a completed residence permit for configured nationalities', () => {
    const { userData, step, files } = eligibleInput();
    userData.kycSteps.push(
      Object.assign(new KycStep(), {
        name: KycStepName.RESIDENCE_PERMIT,
        status: ReviewStatus.MANUAL_REVIEW,
        sequenceNumber: 1,
      }),
    );

    const result = service.evaluatePersonal(userData, step, files, false);

    expect(result.blockers).toContainEqual({ code: DfxApprovalBlocker.MISSING_RESIDENCE_PERMIT });
  });

  it('accepts a disabled nationality only after its required residence permit was completed', () => {
    const { userData, step, files } = eligibleInput();
    userData.nationality.nationalityEnable = false;
    userData.kycSteps.push(
      Object.assign(new KycStep(), {
        name: KycStepName.RESIDENCE_PERMIT,
        status: ReviewStatus.COMPLETED,
        sequenceNumber: 1,
      }),
    );

    const result = service.evaluatePersonal(userData, step, files, false);

    expect(result.blockers).not.toContainEqual({ code: DfxApprovalBlocker.NATIONALITY_DISABLED });
    expect(result.blockers).not.toContainEqual({ code: DfxApprovalBlocker.MISSING_RESIDENCE_PERMIT });
  });
});
