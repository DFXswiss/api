import { ConfigService } from 'src/config/config';
import { Language } from 'src/shared/models/language/language.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { KycStep } from '../../../entities/kyc-step.entity';
import { KycStepName } from '../../../enums/kyc-step-name.enum';
import { KycContext, requiredKycSteps } from '../../../enums/kyc.enum';
import { ReviewStatus } from '../../../enums/review-status.enum';
import { KycLevelDto, KycProcessStatus, KycSessionDto } from '../../output/kyc-info.dto';
import { KycInfoMapper } from '../kyc-info.mapper';

jest.mock('../../../enums/kyc.enum', () => ({
  ...jest.requireActual('../../../enums/kyc.enum'),
  requiredKycSteps: jest.fn(),
}));

describe('KycInfoMapper', () => {
  beforeAll(() => {
    new ConfigService();
  });

  const buildLanguage = (): Language => {
    const lang = new Language();
    lang.symbol = 'EN';
    lang.name = 'English';
    lang.foreignName = 'English';
    lang.enable = true;
    return lang;
  };

  const buildStep = (name: KycStepName, status: ReviewStatus, sequenceNumber = 0): KycStep => {
    const step = new KycStep();
    step.name = name;
    step.status = status;
    step.sequenceNumber = sequenceNumber;
    return step;
  };

  const buildUserData = (overrides: Partial<UserData> = {}): UserData => {
    const userData = new UserData();
    userData.id = 1;
    userData.kycLevel = KycLevel.LEVEL_20;
    userData.language = buildLanguage();
    userData.users = [];
    userData.kycSteps = [];
    return Object.assign(userData, overrides);
  };

  const setRequiredSteps = (...names: KycStepName[]): void => {
    (requiredKycSteps as jest.Mock).mockReturnValue(names);
  };

  describe('computeProcessStatus', () => {
    it('returns Failed for a KYC-terminated user', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.IDENT);
      const userData = buildUserData({ kycLevel: KycLevel.REJECTED });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.FAILED);
    });

    it('returns MergeProcessing when a merge is in progress, overriding actionable steps', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.IDENT);
      const userData = buildUserData({ kycSteps: [] });

      const result = KycInfoMapper.toDto(userData, false, [], undefined, undefined, true) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.MERGE_PROCESSING);
    });

    it('does not return MergeProcessing for a KYC-terminated user (Failed wins)', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.IDENT);
      const userData = buildUserData({ kycLevel: KycLevel.REJECTED });

      const result = KycInfoMapper.toDto(userData, false, [], undefined, undefined, true) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.FAILED);
    });

    it('returns InProgress when there are no real steps and required steps exist (synthetic NotStarted steps)', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.IDENT);
      const userData = buildUserData({ kycSteps: [] });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.IN_PROGRESS);
    });

    it('returns Completed when every required step has a Completed real step', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.IDENT);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.IDENT, ReviewStatus.COMPLETED),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.COMPLETED);
    });

    it('returns PendingReview when all required steps are completed except one in ManualReview', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.IDENT);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.IDENT, ReviewStatus.MANUAL_REVIEW),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.PENDING_REVIEW);
    });

    it('returns InProgress when all required steps are completed except one in InProgress', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.IDENT);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.IDENT, ReviewStatus.IN_PROGRESS),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.IN_PROGRESS);
    });

    it('returns PendingReview when one required step is DataRequested (review-side, not actionable)', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.IDENT);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.IDENT, ReviewStatus.DATA_REQUESTED),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.PENDING_REVIEW);
    });

    it('returns InProgress when one required step is actionable and another is pending (actionable wins)', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.IDENT);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.IN_PROGRESS),
          buildStep(KycStepName.IDENT, ReviewStatus.MANUAL_REVIEW),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.IN_PROGRESS);
    });

    // Incident user shape: the required IDENT step exists three times - one
    // Completed, one Outdated and one InProgress - while every other required
    // step is Completed. getUiSteps()/sortSteps() groups all same-name steps
    // and, because at least one is completed, surfaces ONLY the completed one
    // (Util.maxObj over the completed subset). The Outdated and InProgress
    // sequences are dropped before computeProcessStatus ever sees them, so the
    // verdict collapses to Completed even though the user still has an
    // in-progress ident sequence.
    it('returns Completed for the incident shape (in-progress/outdated ident sequences are hidden by sortSteps)', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.IDENT);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.IDENT, ReviewStatus.COMPLETED, 0),
          buildStep(KycStepName.IDENT, ReviewStatus.OUTDATED, 2),
          buildStep(KycStepName.IDENT, ReviewStatus.IN_PROGRESS, 1),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.COMPLETED);
    });
  });

  // DfxApproval is a DFX-side decision: the user can never act on it. A freshly
  // initiated approval step can momentarily carry an actionable status
  // (KycStep.create defaults to IN_PROGRESS); it must still read as
  // PendingReview and never be surfaced as the user's currentStep — otherwise
  // the client routes it into the actionable lane with no UI (blank screen).
  describe('DfxApproval (non-user-actionable backend step)', () => {
    it('returns PendingReview when the only open required step is DfxApproval InProgress (awaiting DFX)', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.DFX_APPROVAL);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.DFX_APPROVAL, ReviewStatus.IN_PROGRESS),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.PENDING_REVIEW);
    });

    it('still returns InProgress when a real user-actionable step is open alongside DfxApproval', () => {
      setRequiredSteps(KycStepName.IDENT, KycStepName.DFX_APPROVAL);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.IDENT, ReviewStatus.IN_PROGRESS),
          buildStep(KycStepName.DFX_APPROVAL, ReviewStatus.IN_PROGRESS),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.IN_PROGRESS);
    });

    it('never surfaces DfxApproval as the current step, even when it is the only open step', () => {
      // The incident shape: every other required step done, DfxApproval the only
      // open one in an actionable status. Without the guard it becomes
      // `currentStep` and the client gets a step it has no UI for (blank screen).
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.DFX_APPROVAL);
      const contact = buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED);
      contact.id = 1;
      const approval = buildStep(KycStepName.DFX_APPROVAL, ReviewStatus.IN_PROGRESS);
      approval.id = 3;
      const userData = buildUserData({ kycSteps: [contact, approval] });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.kycSteps.find((s) => s.name === KycStepName.DFX_APPROVAL)?.isCurrent).toBeFalsy();
    });

    it('drops an explicitly-passed DfxApproval currentStep (never emitted as the session currentStep)', () => {
      // A caller can pass `currentStep` explicitly (4th arg), bypassing the
      // internal `??=` derivation. A DfxApproval passed this way must still be
      // dropped — otherwise it is emitted as the session currentStep (the
      // blank-screen path).
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.DFX_APPROVAL);
      const approval = buildStep(KycStepName.DFX_APPROVAL, ReviewStatus.IN_PROGRESS);
      approval.id = 3;
      const userData = buildUserData({
        kycSteps: [buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED), approval],
      });

      const result = KycInfoMapper.toDto(userData, true, [], approval) as KycSessionDto;

      expect(result.currentStep).toBeUndefined();
    });

    it('keeps returning PendingReview for an OnHold DfxApproval (unchanged behaviour)', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.DFX_APPROVAL);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.DFX_APPROVAL, ReviewStatus.ON_HOLD),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.PENDING_REVIEW);
    });

    it('keeps returning PendingReview for a ManualReview DfxApproval (unchanged behaviour)', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.DFX_APPROVAL);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.DFX_APPROVAL, ReviewStatus.MANUAL_REVIEW),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.PENDING_REVIEW);
    });

    it('returns Failed for a KYC-terminated user even when DfxApproval is Failed', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.DFX_APPROVAL);
      const userData = buildUserData({
        kycLevel: KycLevel.REJECTED,
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.DFX_APPROVAL, ReviewStatus.FAILED),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.FAILED);
    });

    it('returns PendingReview when DfxApproval is Failed but the user is not KYC-terminated', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.DFX_APPROVAL);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.DFX_APPROVAL, ReviewStatus.FAILED),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.PENDING_REVIEW);
    });
  });

  describe('isRequired flag', () => {
    it('marks a step whose name is in requiredStepNames as required', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.IDENT);
      const userData = buildUserData({
        kycSteps: [buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED)],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;
      const contactStep = result.kycSteps.find((s) => s.name === KycStepName.CONTACT_DATA);

      expect(contactStep?.isRequired).toBe(true);
    });

    it('marks a step whose name is not in requiredStepNames as not required', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.FINANCIAL_DATA, ReviewStatus.COMPLETED),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;
      const financialStep = result.kycSteps.find((s) => s.name === KycStepName.FINANCIAL_DATA);

      expect(financialStep?.isRequired).toBe(false);
    });
  });

  describe('KYC context filtering', () => {
    it('returns Completed for RealunitBuy when LEVEL_30 steps are done, even with FINANCIAL_DATA incomplete', () => {
      setRequiredSteps(
        KycStepName.CONTACT_DATA,
        KycStepName.PERSONAL_DATA,
        KycStepName.NATIONALITY_DATA,
        KycStepName.IDENT,
        KycStepName.FINANCIAL_DATA,
        KycStepName.DFX_APPROVAL,
      );
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.PERSONAL_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.NATIONALITY_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.IDENT, ReviewStatus.COMPLETED),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, [], undefined, KycContext.REALUNIT_BUY) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.COMPLETED);
      expect(result.kycSteps.find((s) => s.name === KycStepName.FINANCIAL_DATA)?.isRequired).toBe(false);
      expect(result.kycSteps.find((s) => s.name === KycStepName.DFX_APPROVAL)?.isRequired).toBe(false);
    });

    it('returns InProgress for RealunitSell when FINANCIAL_DATA is incomplete (no filtering)', () => {
      setRequiredSteps(
        KycStepName.CONTACT_DATA,
        KycStepName.IDENT,
        KycStepName.FINANCIAL_DATA,
        KycStepName.DFX_APPROVAL,
      );
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.IDENT, ReviewStatus.COMPLETED),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, [], undefined, KycContext.REALUNIT_SELL) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.IN_PROGRESS);
      expect(result.kycSteps.find((s) => s.name === KycStepName.FINANCIAL_DATA)?.isRequired).toBe(true);
    });

    it('behaves unchanged without a context (backwards compatible)', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.FINANCIAL_DATA);
      const userData = buildUserData({
        kycSteps: [buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED)],
      });

      const result = KycInfoMapper.toDto(userData, false, []) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.IN_PROGRESS);
      expect(result.kycSteps.find((s) => s.name === KycStepName.FINANCIAL_DATA)?.isRequired).toBe(true);
    });

    it('returns PendingReview for RealunitBuy when IDENT is still in ManualReview', () => {
      setRequiredSteps(
        KycStepName.CONTACT_DATA,
        KycStepName.PERSONAL_DATA,
        KycStepName.NATIONALITY_DATA,
        KycStepName.IDENT,
        KycStepName.FINANCIAL_DATA,
        KycStepName.DFX_APPROVAL,
      );
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.PERSONAL_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.NATIONALITY_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.IDENT, ReviewStatus.MANUAL_REVIEW),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, [], undefined, KycContext.REALUNIT_BUY) as KycLevelDto;

      expect(result.processStatus).toBe(KycProcessStatus.PENDING_REVIEW);
    });

    it('intersects context whitelist with user-specific required steps (RECOMMENDATION only when both agree)', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.IDENT, KycStepName.RECOMMENDATION);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.IDENT, ReviewStatus.COMPLETED),
        ],
      });

      const result = KycInfoMapper.toDto(userData, false, [], undefined, KycContext.REALUNIT_BUY) as KycLevelDto;

      expect(result.kycSteps.find((s) => s.name === KycStepName.RECOMMENDATION)?.isRequired).toBe(true);
      expect(result.processStatus).toBe(KycProcessStatus.IN_PROGRESS);
    });
  });

  // `processStatus` already reports only over the context's steps; `currentStep` did not, so a step that is
  // irrelevant to the flow could hijack it and send the caller somewhere its flow never asked for.
  describe('currentStep context scoping', () => {
    const session = (userData: UserData, context?: KycContext): KycSessionDto =>
      KycInfoMapper.toDto(userData, true, [], undefined, context) as KycSessionDto;

    // OwnerDirectory sorts BEFORE ResidencePermit in the step order, so the unscoped fallback would reach it
    // first. Picking a later-sorting out-of-context step would pass either way and prove nothing.
    it('does not surface an out-of-context step as currentStep', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.RESIDENCE_PERMIT);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.OWNER_DIRECTORY, ReviewStatus.IN_PROGRESS),
          buildStep(KycStepName.RESIDENCE_PERMIT, ReviewStatus.IN_PROGRESS),
        ],
      });

      expect(session(userData, KycContext.REALUNIT_BUY).currentStep?.name).toBe(KycStepName.RESIDENCE_PERMIT);
    });

    it('leaves currentStep undefined when only out-of-context steps are open', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.NATIONALITY_DATA);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.NATIONALITY_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.ADDRESS_CHANGE, ReviewStatus.IN_PROGRESS),
        ],
      });

      const result = session(userData, KycContext.REALUNIT_BUY);
      // the context is satisfied, so the caller is done — it must not be pointed at the change step
      expect(result.currentStep).toBeUndefined();
      expect(result.processStatus).toBe(KycProcessStatus.COMPLETED);
    });

    it('applies the same scoping to the FAILED fallback', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.RESIDENCE_PERMIT);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.OWNER_DIRECTORY, ReviewStatus.FAILED),
          buildStep(KycStepName.RESIDENCE_PERMIT, ReviewStatus.FAILED),
        ],
      });

      expect(session(userData, KycContext.REALUNIT_BUY).currentStep?.name).toBe(KycStepName.RESIDENCE_PERMIT);
    });

    // The regression guard for every other client. AddressChange/PhoneChange/NameChange/PaymentAgreement are
    // NOT members of requiredKycSteps, so scoping by requiredStepNames instead of the context set would drop
    // them from currentStep for callers that pass no context and break the change flows.
    it('still surfaces a change step when no context is supplied', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.NATIONALITY_DATA);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.ADDRESS_CHANGE, ReviewStatus.IN_PROGRESS),
        ],
      });

      expect(session(userData).currentStep?.name).toBe(KycStepName.ADDRESS_CHANGE);
    });

    it('does not narrow anything for a context without a step whitelist (RealunitSell)', () => {
      setRequiredSteps(KycStepName.CONTACT_DATA, KycStepName.NATIONALITY_DATA);
      const userData = buildUserData({
        kycSteps: [
          buildStep(KycStepName.CONTACT_DATA, ReviewStatus.COMPLETED),
          buildStep(KycStepName.ADDRESS_CHANGE, ReviewStatus.IN_PROGRESS),
        ],
      });

      expect(session(userData, KycContext.REALUNIT_SELL).currentStep?.name).toBe(KycStepName.ADDRESS_CHANGE);
    });
  });
});
