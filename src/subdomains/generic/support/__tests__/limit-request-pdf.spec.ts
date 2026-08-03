import { createMock } from '@golevelup/ts-jest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TestUtil } from 'src/shared/utils/test.util';
import {
  FundOrigin,
  InvestmentDate,
  LimitRequestDecision,
} from '../../../supporting/support-issue/entities/limit-request.entity';
import { FileSubType, FileType } from '../../kyc/dto/kyc-file.dto';
import { ContentType } from '../../kyc/enums/content-type.enum';
import { KycDocumentService } from '../../kyc/services/integration/kyc-document.service';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { GenerateLimitRequestPdfDto } from '../dto/limit-request-pdf.dto';
import { SupportPdfService, effectiveNewLimit } from '../support-pdf.service';
import { SupportService } from '../support.service';

const USER_DATA_ID = 397328;

function acceptedDto(): GenerateLimitRequestPdfDto {
  return {
    decision: LimitRequestDecision.ACCEPTED,
    clerk: 'JR',
    requestedLimit: 500000,
    grantedLimit: 500000,
    previousLimit: 100000,
    fundOrigin: FundOrigin.SAVINGS,
    investmentDate: InvestmentDate.NOW,
    note: 'Kaufvertrag geprüft',
  };
}

describe('SupportService.generateAndSaveLimitRequestPdf', () => {
  let service: SupportService;
  let userDataService: UserDataService;
  let supportPdfService: SupportPdfService;
  let kycDocumentService: KycDocumentService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [SupportService, TestUtil.provideConfig()],
    })
      .useMocker(() => createMock())
      .compile();

    service = module.get(SupportService);
    userDataService = module.get(UserDataService);
    supportPdfService = module.get(SupportPdfService);
    kycDocumentService = module.get(KycDocumentService);

    jest.spyOn(userDataService, 'getUserData').mockResolvedValue(Object.assign(new UserData(), { id: USER_DATA_ID }));
    jest.spyOn(supportPdfService, 'createLimitRequestPdf').mockResolvedValue(Buffer.from('pdf').toString('base64'));
    jest.spyOn(kycDocumentService, 'uploadUserFile').mockResolvedValue({ url: 'https://files/report.pdf' } as never);
  });

  // The sheet filed every decision under UserNotes/LimitRequestReport; keeping both keeps old and new
  // reports in one folder and one document filter.
  it('stores the report as a protected UserNotes / LimitRequestReport file', async () => {
    await service.generateAndSaveLimitRequestPdf(USER_DATA_ID, acceptedDto());

    const [userData, fileType, fileName, buffer, contentType, isProtected, kycStep, subType] = jest.mocked(
      kycDocumentService.uploadUserFile,
    ).mock.calls[0];
    expect(userData.id).toBe(USER_DATA_ID);
    expect(fileType).toBe(FileType.USER_NOTES);
    expect(contentType).toBe(ContentType.PDF);
    expect(isProtected).toBe(true);
    expect(kycStep).toBeUndefined();
    expect(subType).toBe(FileSubType.LIMIT_REQUEST_REPORT);
    expect(buffer.toString()).toBe('pdf');
    expect(fileName).toMatch(/^\d{8}-LimitRequest-0-397328-\d{6}\.pdf$/);
  });

  it('returns the generated data under the same name it stored', async () => {
    const result = await service.generateAndSaveLimitRequestPdf(USER_DATA_ID, acceptedDto());

    const [, , storedName] = jest.mocked(kycDocumentService.uploadUserFile).mock.calls[0];
    expect(result.fileName).toBe(storedName);
    expect(result.pdfData).toBe(Buffer.from('pdf').toString('base64'));
  });

  it('passes the decision through to the renderer unchanged', async () => {
    const dto = acceptedDto();

    await service.generateAndSaveLimitRequestPdf(USER_DATA_ID, dto);

    expect(supportPdfService.createLimitRequestPdf).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_DATA_ID }),
      dto,
    );
  });

  it('rejects an unknown account before writing anything', async () => {
    jest.spyOn(userDataService, 'getUserData').mockResolvedValue(undefined);

    await expect(service.generateAndSaveLimitRequestPdf(USER_DATA_ID, acceptedDto())).rejects.toThrow(
      NotFoundException,
    );
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  it('rejects a granting decision without grantedLimit before writing anything', async () => {
    const dto: GenerateLimitRequestPdfDto = {
      decision: LimitRequestDecision.ACCEPTED,
      clerk: 'JR',
      requestedLimit: 500000,
      previousLimit: 100000,
      fundOrigin: FundOrigin.SAVINGS,
      investmentDate: InvestmentDate.NOW,
      note: 'Kaufvertrag geprüft',
    };

    await expect(service.generateAndSaveLimitRequestPdf(USER_DATA_ID, dto)).rejects.toThrow(BadRequestException);
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  it('rejects a non-granting decision that carries a grantedLimit', async () => {
    const dto: GenerateLimitRequestPdfDto = {
      decision: LimitRequestDecision.REJECTED,
      clerk: 'JR',
      requestedLimit: 500000,
      grantedLimit: 500000,
      previousLimit: 100000,
    };

    await expect(service.generateAndSaveLimitRequestPdf(USER_DATA_ID, dto)).rejects.toThrow(BadRequestException);
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  it('accepts a partially accepted decision with a grantedLimit', async () => {
    const dto: GenerateLimitRequestPdfDto = {
      decision: LimitRequestDecision.PARTIALLY_ACCEPTED,
      clerk: 'JR',
      requestedLimit: 500000,
      grantedLimit: 300000,
      previousLimit: 100000,
    };

    await expect(service.generateAndSaveLimitRequestPdf(USER_DATA_ID, dto)).resolves.toBeDefined();
  });
});

describe('SupportPdfService.createLimitRequestPdf', () => {
  const pdfService = new SupportPdfService();
  const userData = Object.assign(new UserData(), {
    id: USER_DATA_ID,
    firstname: 'Birgit',
    surname: 'Muster',
    verifiedName: 'Birgit Muster',
    kycLevel: 50,
  });

  async function renderText(dto: GenerateLimitRequestPdfDto): Promise<string> {
    const base64 = await pdfService.createLimitRequestPdf(userData, dto);
    // The PDF's text is stored deflated; asserting on the raw bytes would only prove it is a PDF. The
    // renderer is exercised end to end here, and the field content is asserted through the DTO above.
    return Buffer.from(base64, 'base64').toString('latin1');
  }

  it('renders a valid PDF for an acceptance', async () => {
    const content = await renderText(acceptedDto());

    expect(content.startsWith('%PDF')).toBe(true);
    expect(content.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  // A rejection carries no granted limit; the renderer has to fall back to the previous one rather
  // than print an empty "new limit" that a later reader would have to interpret.
  it('renders a rejection without a granted limit', async () => {
    const content = await renderText({
      decision: LimitRequestDecision.REJECTED,
      clerk: 'JR',
      requestedLimit: 500000,
      previousLimit: 100000,
    });

    expect(content.startsWith('%PDF')).toBe(true);
  });

  // `user_data.depositLimit` is a float column: an account carrying a non-integer limit must still get
  // its report, or the decision that produced it would fail on the report step.
  it('renders a non-integer previous limit', async () => {
    const content = await renderText({
      decision: LimitRequestDecision.REJECTED,
      clerk: 'JR',
      requestedLimit: 500000,
      previousLimit: 99999.5,
    });

    expect(content.startsWith('%PDF')).toBe(true);
  });

  it('renders without optional context at all', async () => {
    const content = await renderText({
      decision: LimitRequestDecision.REJECTED,
      clerk: 'JR',
      requestedLimit: 500000,
    });

    expect(content.startsWith('%PDF')).toBe(true);
  });
});

describe('effectiveNewLimit', () => {
  it('returns the granted limit for an acceptance', () => {
    const dto: GenerateLimitRequestPdfDto = {
      decision: LimitRequestDecision.ACCEPTED,
      clerk: 'JR',
      requestedLimit: 500000,
      grantedLimit: 500000,
      previousLimit: 100000,
    };

    expect(effectiveNewLimit(dto)).toBe(500000);
  });

  it('returns the granted limit for a partial acceptance', () => {
    const dto: GenerateLimitRequestPdfDto = {
      decision: LimitRequestDecision.PARTIALLY_ACCEPTED,
      clerk: 'JR',
      requestedLimit: 500000,
      grantedLimit: 300000,
      previousLimit: 100000,
    };

    expect(effectiveNewLimit(dto)).toBe(300000);
  });

  it('returns the previous limit for a rejection', () => {
    const dto: GenerateLimitRequestPdfDto = {
      decision: LimitRequestDecision.REJECTED,
      clerk: 'JR',
      requestedLimit: 500000,
      previousLimit: 100000,
    };

    expect(effectiveNewLimit(dto)).toBe(100000);
  });

  it('returns undefined when a rejection has no previous limit', () => {
    const dto: GenerateLimitRequestPdfDto = {
      decision: LimitRequestDecision.REJECTED,
      clerk: 'JR',
      requestedLimit: 500000,
    };

    expect(effectiveNewLimit(dto)).toBeUndefined();
  });
});
