import { createMock } from '@golevelup/ts-jest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { extractPdfText } from 'src/shared/utils/__tests__/pdf-text.util';
import { TestUtil } from 'src/shared/utils/test.util';
import {
  FundOrigin,
  InvestmentDate,
  LimitRequestDecision,
} from 'src/subdomains/supporting/support-issue/entities/limit-request.entity';
import { FileSubType, FileType } from '../../kyc/dto/kyc-file.dto';
import { ContentType } from '../../kyc/enums/content-type.enum';
import { KycDocumentService } from '../../kyc/services/integration/kyc-document.service';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { GenerateLimitRequestPdfDto } from '../dto/limit-request-pdf.dto';
import { SupportPdfService } from '../support-pdf.service';
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

describe('GenerateLimitRequestPdfDto validation', () => {
  const validateDto = async (raw: Record<string, unknown>) =>
    validate(plainToInstance(GenerateLimitRequestPdfDto, raw));

  const validRaw = (): Record<string, unknown> => ({
    decision: LimitRequestDecision.ACCEPTED,
    clerk: 'JR',
    requestedLimit: 500000,
    grantedLimit: 500000,
  });

  it('accepts a fully valid payload', async () => {
    expect(await validateDto(validRaw())).toEqual([]);
  });

  it('rejects an unknown decision string', async () => {
    const errors = await validateDto({ ...validRaw(), decision: 'NotARealDecision' });
    expect(errors.find((e) => e.property === 'decision')).toBeDefined();
  });

  it('rejects an unknown fundOrigin string', async () => {
    const errors = await validateDto({ ...validRaw(), fundOrigin: 'NotARealOrigin' });
    expect(errors.find((e) => e.property === 'fundOrigin')).toBeDefined();
  });

  it('rejects an unknown investmentDate string', async () => {
    const errors = await validateDto({ ...validRaw(), investmentDate: 'NotARealDate' });
    expect(errors.find((e) => e.property === 'investmentDate')).toBeDefined();
  });

  it('trims the note like the clerk', async () => {
    const dto = plainToInstance(GenerateLimitRequestPdfDto, { ...validRaw(), note: '  Aktennotiz  ' });
    expect(dto.note).toBe('Aktennotiz');
  });

  it('rejects an empty clerk', async () => {
    const errors = await validateDto({ ...validRaw(), clerk: '' });
    expect(errors.find((e) => e.property === 'clerk')).toBeDefined();
  });

  it('rejects requestedLimit sent as a string', async () => {
    const errors = await validateDto({ ...validRaw(), requestedLimit: '500000' });
    expect(errors.find((e) => e.property === 'requestedLimit')).toBeDefined();
  });

  it('rejects a non-integer requestedLimit', async () => {
    const errors = await validateDto({ ...validRaw(), requestedLimit: 1.5 });
    expect(errors.find((e) => e.property === 'requestedLimit')).toBeDefined();
  });

  // `user_data.depositLimit` is a float column: an account carrying a non-integer limit must still be
  // reportable, so previousLimit (unlike requestedLimit) stays @IsNumber.
  it('accepts a non-integer previousLimit', async () => {
    const errors = await validateDto({
      decision: LimitRequestDecision.REJECTED,
      clerk: 'JR',
      requestedLimit: 500000,
      previousLimit: 99999.5,
    });
    expect(errors).toEqual([]);
  });
});

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
    jest.spyOn(kycDocumentService, 'listFilesByPrefix').mockResolvedValue([]);
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
      expect.any(Date),
    );
  });

  it('rejects an unknown account before writing anything', async () => {
    jest.spyOn(userDataService, 'getUserData').mockResolvedValue(undefined);

    await expect(service.generateAndSaveLimitRequestPdf(USER_DATA_ID, acceptedDto())).rejects.toThrow(
      NotFoundException,
    );
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  // --- Fail-closed decision/limit consistency (before any PDF is rendered or uploaded) --- //

  it('rejects a non-final decision', async () => {
    const dto = { ...acceptedDto(), decision: LimitRequestDecision.APPROVED_1_OF_2 };

    await expect(service.generateAndSaveLimitRequestPdf(USER_DATA_ID, dto)).rejects.toThrow(BadRequestException);
    expect(supportPdfService.createLimitRequestPdf).not.toHaveBeenCalled();
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  it('rejects a granting decision without a grantedLimit', async () => {
    const dto = { ...acceptedDto(), grantedLimit: undefined };

    await expect(service.generateAndSaveLimitRequestPdf(USER_DATA_ID, dto)).rejects.toThrow(BadRequestException);
    expect(supportPdfService.createLimitRequestPdf).not.toHaveBeenCalled();
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  it('rejects a rejection that carries a grantedLimit', async () => {
    const dto: GenerateLimitRequestPdfDto = {
      decision: LimitRequestDecision.REJECTED,
      clerk: 'JR',
      requestedLimit: 500000,
      grantedLimit: 500000,
      previousLimit: 100000,
    };

    await expect(service.generateAndSaveLimitRequestPdf(USER_DATA_ID, dto)).rejects.toThrow(BadRequestException);
    expect(supportPdfService.createLimitRequestPdf).not.toHaveBeenCalled();
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  it('rejects a rejection without a previousLimit', async () => {
    const dto: GenerateLimitRequestPdfDto = {
      decision: LimitRequestDecision.REJECTED,
      clerk: 'JR',
      requestedLimit: 500000,
    };

    await expect(service.generateAndSaveLimitRequestPdf(USER_DATA_ID, dto)).rejects.toThrow(BadRequestException);
    expect(supportPdfService.createLimitRequestPdf).not.toHaveBeenCalled();
    expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
  });

  // --- File name: UTC, so it stays consistent with the PDF footer regardless of the server's local TZ --- //

  it("builds the file name from UTC date components, independent of the runner's local timezone", async () => {
    const originalTz = process.env.TZ;
    // UTC+14 — the widest positive offset that exists, so a UTC-evening instant falls on the NEXT
    // calendar day locally; a regression to local Date getters would show up as a wrong file name.
    process.env.TZ = 'Pacific/Kiritimati';
    jest.useFakeTimers().setSystemTime(new Date('2026-01-15T23:05:09.000Z'));

    try {
      await service.generateAndSaveLimitRequestPdf(USER_DATA_ID, acceptedDto());
      const [, , fileName] = jest.mocked(kycDocumentService.uploadUserFile).mock.calls[0];
      expect(fileName).toBe(`20260115-LimitRequest-0-${USER_DATA_ID}-230509.pdf`);
    } finally {
      jest.useRealTimers();
      process.env.TZ = originalTz;
    }
  });

  // --- Collision guard: never silently overwrite an existing report --- //

  it('refuses to upload when a report of the same name already exists', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-10T08:15:30.000Z'));
    const expectedBlobPath = `user/${USER_DATA_ID}/UserNotes/20260310-LimitRequest-0-${USER_DATA_ID}-081530.pdf`;

    try {
      jest
        .spyOn(kycDocumentService, 'listFilesByPrefix')
        .mockImplementation(async (prefix: string) =>
          prefix === expectedBlobPath ? [{ path: expectedBlobPath } as never] : [],
        );

      await expect(service.generateAndSaveLimitRequestPdf(USER_DATA_ID, acceptedDto())).rejects.toThrow(
        ConflictException,
      );
      expect(kycDocumentService.uploadUserFile).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('uploads when only a near-prefix match exists (not an exact collision)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-10T08:15:30.000Z'));
    const expectedBlobPath = `user/${USER_DATA_ID}/UserNotes/20260310-LimitRequest-0-${USER_DATA_ID}-081530.pdf`;

    try {
      jest
        .spyOn(kycDocumentService, 'listFilesByPrefix')
        .mockImplementation(async () => [{ path: `${expectedBlobPath}.backup` } as never]);

      await service.generateAndSaveLimitRequestPdf(USER_DATA_ID, acceptedDto());

      expect(kycDocumentService.uploadUserFile).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
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
  const generatedAt = new Date('2026-02-01T12:00:00.000Z');

  async function renderText(dto: GenerateLimitRequestPdfDto): Promise<string> {
    const base64 = await pdfService.createLimitRequestPdf(userData, dto, generatedAt);
    return Buffer.from(base64, 'base64').toString('latin1');
  }

  it('renders a valid PDF for an acceptance', async () => {
    const content = await renderText(acceptedDto());

    expect(content.startsWith('%PDF')).toBe(true);
    expect(content.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  // A rejection carries no granted limit; the renderer selects the previous limit for the "new limit"
  // field instead, rather than print an empty value that a later reader would have to interpret.
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

  it('shows the previous limit as the new limit on a rejection', async () => {
    const base64 = await pdfService.createLimitRequestPdf(
      userData,
      {
        decision: LimitRequestDecision.REJECTED,
        clerk: 'JR',
        requestedLimit: 500,
        previousLimit: 42,
      },
      generatedAt,
    );
    const text = extractPdfText(base64);
    const afterLabel = text.slice(text.indexOf('Neues Jahreslimit'));

    expect(afterLabel).toContain('42 CHF');
  });

  it('shows the granted limit as the new limit on an acceptance', async () => {
    const base64 = await pdfService.createLimitRequestPdf(
      userData,
      {
        decision: LimitRequestDecision.ACCEPTED,
        clerk: 'JR',
        requestedLimit: 500,
        grantedLimit: 77,
        previousLimit: 42,
      },
      generatedAt,
    );
    const text = extractPdfText(base64);
    const afterLabel = text.slice(text.indexOf('Neues Jahreslimit'));

    expect(afterLabel).toContain('77 CHF');
    expect(afterLabel.slice(0, afterLabel.indexOf('Bearbeitet'))).not.toContain('42 CHF');
  });
});
