import { createMock } from '@golevelup/ts-jest';
import { Config, ConfigService } from 'src/config/config';
import { AccountType } from '../../../user/models/user-data/account-type.enum';
import { createCustomUserData } from '../../../user/models/user-data/__mocks__/user-data.entity.mock';
import { KycLevel } from '../../../user/models/user-data/user-data.enum';
import { FileSubType } from '../../dto/kyc-file.dto';
import { DfxApprovalBlocker } from '../../dto/output/dfx-approval-status.dto';
import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepName } from '../../enums/kyc-step-name.enum';
import { ReviewStatus } from '../../enums/review-status.enum';
import { KycStepRepository } from '../../repositories/kyc-step.repository';
import { DfxApprovalCheckService } from '../dfx-approval-check.service';
import { DfxApprovalDocumentService } from '../dfx-approval-document.service';
import { DfxApprovalWorkflowService } from '../dfx-approval-workflow.service';
import { KycNotificationService } from '../kyc-notification.service';
import { NameCheckService } from '../name-check.service';

describe('DfxApprovalWorkflowService', () => {
  let service: DfxApprovalWorkflowService;
  let stepRepo: jest.Mocked<KycStepRepository>;
  let documentService: jest.Mocked<DfxApprovalDocumentService>;
  let notificationService: jest.Mocked<KycNotificationService>;
  let checkService: jest.Mocked<DfxApprovalCheckService>;

  function pendingStep(): KycStep {
    const userData = createCustomUserData({
      id: 42,
      accountType: AccountType.PERSONAL,
      kycLevel: KycLevel.LEVEL_40,
      kycFiles: [],
      kycSteps: [],
    });
    const step = Object.assign(new KycStep(), {
      id: 11,
      name: KycStepName.DFX_APPROVAL,
      status: ReviewStatus.MANUAL_REVIEW,
      sequenceNumber: 1,
      userData,
    });
    userData.kycSteps = [step];
    return step;
  }

  beforeEach(() => {
    if (!Config) new ConfigService();
    Config.kyc.dfxApprovalWorkflowEnabled = true;
    stepRepo = createMock<KycStepRepository>();
    documentService = createMock<DfxApprovalDocumentService>();
    notificationService = createMock<KycNotificationService>();
    checkService = createMock<DfxApprovalCheckService>();
    checkService.evaluatePersonal.mockReturnValue({
      ready: false,
      blockers: [{ code: DfxApprovalBlocker.MISSING_DOCUMENT, documentSubType: FileSubType.RISK_PROFILE }],
    });
    service = new DfxApprovalWorkflowService(
      stepRepo,
      checkService,
      documentService,
      createMock<NameCheckService>(),
      notificationService,
    );
  });

  afterEach(() => {
    Config.kyc.dfxApprovalWorkflowEnabled = false;
  });

  it('stays inactive until the explicit cutover flag is enabled', async () => {
    Config.kyc.dfxApprovalWorkflowEnabled = false;

    await service.reviewPersonalApprovals();

    expect(stepRepo.find).not.toHaveBeenCalled();
  });

  it('serializes every pending candidate through the cross-instance step lock', async () => {
    const first = pendingStep();
    const second = pendingStep();
    second.id = 12;
    stepRepo.find.mockResolvedValue([first, second]);
    const lock = jest.spyOn(service as any, 'withStepLock').mockResolvedValue(undefined);

    await service.reviewPersonalApprovals();

    expect(lock).toHaveBeenCalledTimes(2);
    expect(lock).toHaveBeenNthCalledWith(1, 11, expect.any(Function));
    expect(lock).toHaveBeenNthCalledWith(2, 12, expect.any(Function));
  });

  it('uses a blocking cross-instance lock for a manual decision', async () => {
    const lock = jest.spyOn(service as any, 'withStepLock').mockResolvedValue(undefined);

    await service.applyManualDecision(11, 99, ReviewStatus.COMPLETED, '{}', undefined, {
      complexOrgStructure: false,
      highRisk: false,
      depositLimit: 100000,
      amlAccountType: 'natural person',
    });

    expect(lock).toHaveBeenCalledWith(11, expect.any(Function), true);
  });

  it('initializes risk data, creates documents and only then completes and notifies', async () => {
    const step = pendingStep();
    jest.spyOn(service as any, 'loadStep').mockResolvedValue(step);
    const initialize = jest.spyOn(service as any, 'initializePersonalRiskData').mockResolvedValue(undefined);
    const complete = jest.spyOn(service as any, 'completeIfReady').mockResolvedValue(step.userData);
    (service as any).nameCheckService.hasOpenNameChecks.mockResolvedValue(false);

    await (service as any).processPersonalApproval(step.id);

    expect(initialize.mock.invocationCallOrder[0]).toBeLessThan(
      (documentService.generateMissingPersonalDocuments as jest.Mock).mock.invocationCallOrder[0],
    );
    expect((documentService.generateMissingPersonalDocuments as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      complete.mock.invocationCallOrder[0],
    );
    expect(notificationService.kycChanged).toHaveBeenCalledWith(step.userData, KycLevel.LEVEL_50);
  });

  it('does not touch documents after the step has already advanced', async () => {
    const step = pendingStep();
    step.status = ReviewStatus.COMPLETED;
    jest.spyOn(service as any, 'loadStep').mockResolvedValue(step);

    await (service as any).processPersonalApproval(step.id);

    expect(documentService.generateMissingPersonalDocuments).not.toHaveBeenCalled();
    expect(notificationService.kycChanged).not.toHaveBeenCalled();
  });

  it('does not generate documents while a non-document prerequisite is blocked', async () => {
    const step = pendingStep();
    jest.spyOn(service as any, 'loadStep').mockResolvedValue(step);
    jest.spyOn(service as any, 'initializePersonalRiskData').mockResolvedValue(undefined);
    (service as any).nameCheckService.hasOpenNameChecks.mockResolvedValue(false);
    checkService.evaluatePersonal.mockReturnValue({
      ready: false,
      blockers: [
        { code: DfxApprovalBlocker.MISSING_BIRTHDAY },
        { code: DfxApprovalBlocker.MISSING_DOCUMENT, documentSubType: FileSubType.RISK_PROFILE },
      ],
    });

    await (service as any).processPersonalApproval(step.id);

    expect(documentService.generateMissingPersonalDocuments).not.toHaveBeenCalled();
  });
});
