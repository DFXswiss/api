import { createMock } from '@golevelup/ts-jest';
import { AccountType } from '../../../user/models/user-data/account-type.enum';
import { createCustomUserData } from '../../../user/models/user-data/__mocks__/user-data.entity.mock';
import { FileSubType } from '../../dto/kyc-file.dto';
import { KycStep } from '../../entities/kyc-step.entity';
import { NameCheckLogRepository } from '../../repositories/name-check-log.repository';
import { DfxApprovalDocumentService } from '../dfx-approval-document.service';
import { DfxApprovalPdfService } from '../dfx-approval-pdf.service';
import { KycDocumentService } from '../integration/kyc-document.service';

describe('DfxApprovalDocumentService', () => {
  let service: DfxApprovalDocumentService;
  let nameCheckRepo: jest.Mocked<NameCheckLogRepository>;
  let pdfService: jest.Mocked<DfxApprovalPdfService>;
  let documentService: jest.Mocked<KycDocumentService>;
  const userData = createCustomUserData({ id: 42, accountType: AccountType.PERSONAL, kycFiles: [], kycSteps: [] });
  const step = Object.assign(new KycStep(), { id: 11, userData });

  beforeEach(() => {
    nameCheckRepo = createMock<NameCheckLogRepository>();
    pdfService = createMock<DfxApprovalPdfService>();
    documentService = createMock<KycDocumentService>();
    documentService.findGeneratedUserFile.mockResolvedValue(null);
    nameCheckRepo.findOne.mockResolvedValue(null);
    pdfService.generate.mockResolvedValue(Buffer.from('pdf'));
    pdfService.fileName.mockReturnValue('document.pdf');
    service = new DfxApprovalDocumentService(nameCheckRepo, pdfService, documentService);
  });

  it('generates non-NameCheck documents without NameCheck evidence', async () => {
    await service.generateMissingPersonalDocuments(userData, step, [], [FileSubType.FORM_A]);

    expect(documentService.ensureGeneratedUserFile).toHaveBeenCalledWith(
      `dfx-approval:${userData.id}:${FileSubType.FORM_A}:v1`,
      userData,
      expect.any(String),
      FileSubType.FORM_A,
      'document.pdf',
      Buffer.from('pdf'),
      { workflow: 'DfxApproval', version: 'v1', stepId: String(step.id) },
    );
  });

  it('continues with independent documents after one renderer fails', async () => {
    pdfService.generate.mockImplementation(async (subType) => {
      if (subType === FileSubType.CUSTOMER_PROFILE) throw new Error('invalid FinancialData');
      return Buffer.from('pdf');
    });

    await expect(
      service.generateMissingPersonalDocuments(userData, step, [], [FileSubType.CUSTOMER_PROFILE, FileSubType.FORM_A]),
    ).rejects.toThrow('CustomerProfile: invalid FinancialData');

    expect(documentService.ensureGeneratedUserFile).toHaveBeenCalledTimes(1);
    expect(documentService.ensureGeneratedUserFile).toHaveBeenCalledWith(
      expect.stringContaining(FileSubType.FORM_A),
      userData,
      expect.any(String),
      FileSubType.FORM_A,
      expect.any(String),
      expect.any(Buffer),
      expect.any(Object),
    );
  });

  it('requires NameCheck evidence only for the DfxNameCheck document', async () => {
    await expect(
      service.generateMissingPersonalDocuments(userData, step, [], [FileSubType.DFX_NAME_CHECK]),
    ).rejects.toThrow(`NameCheck evidence is missing for userData ${userData.id}`);

    expect(pdfService.generate).not.toHaveBeenCalled();
  });

  it('keeps the other documents of the same case when NameCheck evidence is missing', async () => {
    await expect(
      service.generateMissingPersonalDocuments(
        userData,
        step,
        [],
        [FileSubType.DFX_NAME_CHECK, FileSubType.GWG_FILE_COVER, FileSubType.FORM_A],
      ),
    ).rejects.toThrow('NameCheck evidence is missing');

    expect(documentService.ensureGeneratedUserFile).toHaveBeenCalledTimes(2);
    expect(documentService.ensureGeneratedUserFile).toHaveBeenCalledWith(
      expect.stringContaining(FileSubType.GWG_FILE_COVER),
      ...Array(6).fill(expect.anything()),
    );
  });

  it('generates account-bound documents without a KYC step', async () => {
    await service.generateMissingPersonalDocuments(userData, undefined, [], [FileSubType.FORM_A]);

    expect(documentService.ensureGeneratedUserFile).toHaveBeenCalledWith(
      expect.any(String),
      userData,
      expect.any(String),
      FileSubType.FORM_A,
      expect.any(String),
      expect.any(Buffer),
      { workflow: 'DfxApproval', version: 'v1' },
    );
  });

  it('reuses the registered file name when a document is generated again', async () => {
    documentService.findGeneratedUserFile.mockResolvedValue({ name: 'first-attempt.pdf' } as never);

    await service.generateMissingPersonalDocuments(userData, step, [], [FileSubType.FORM_A]);

    expect(pdfService.generate).toHaveBeenCalledWith(
      FileSubType.FORM_A,
      expect.objectContaining({ documentName: 'first-attempt.pdf' }),
    );
    expect(documentService.ensureGeneratedUserFile).toHaveBeenCalledWith(
      expect.any(String),
      userData,
      expect.any(String),
      FileSubType.FORM_A,
      'first-attempt.pdf',
      expect.any(Buffer),
      expect.any(Object),
    );
  });
});
