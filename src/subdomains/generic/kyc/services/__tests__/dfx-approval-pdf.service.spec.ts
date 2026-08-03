import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { createCustomCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { createDefaultLanguage } from 'src/shared/models/language/__mocks__/language.entity.mock';
import { createCustomUserData } from '../../../user/models/user-data/__mocks__/user-data.entity.mock';
import { AccountType } from '../../../user/models/user-data/account-type.enum';
import { FileSubType } from '../../dto/kyc-file.dto';
import { KycStep } from '../../entities/kyc-step.entity';
import { NameCheckLog, NameCheckRiskStatus } from '../../entities/name-check-log.entity';
import { KycStepName } from '../../enums/kyc-step-name.enum';
import { ReviewStatus } from '../../enums/review-status.enum';
import { DfxApprovalPdfContext, DfxApprovalPdfService } from '../dfx-approval-pdf.service';

describe('DfxApprovalPdfService', () => {
  const service = new DfxApprovalPdfService();
  const generatedAt = new Date('2026-07-31T20:00:00.000Z');

  function context(): DfxApprovalPdfContext {
    const country = createCustomCountry({ name: 'Switzerland', symbol: 'CH' });
    const financialStep = Object.assign(new KycStep(), {
      name: KycStepName.FINANCIAL_DATA,
      status: ReviewStatus.COMPLETED,
      sequenceNumber: 1,
      result: JSON.stringify([
        { key: 'occupation', value: 'employed' },
        { key: 'occupation_description', value: 'Software development' },
        { key: 'sector', value: 'it' },
        { key: 'income', value: '50k_100k' },
        { key: 'assets', value: '100k_500k' },
        { key: 'source_of_funds', value: 'employment_income' },
        { key: 'risky_business', value: 'no_risky_business' },
      ]),
    });
    const userData = createCustomUserData({
      id: 42,
      accountType: AccountType.PERSONAL,
      firstname: 'Test',
      surname: 'Person',
      verifiedName: 'Test Person',
      birthday: new Date('1990-01-01'),
      street: 'Example Street',
      houseNumber: '1',
      zip: '8000',
      location: 'Zurich',
      country,
      verifiedCountry: country,
      nationality: country,
      language: createDefaultLanguage(),
      phone: '+41000000000',
      identDocumentType: 'PASSPORT',
      identDocumentId: 'TEST-DOC',
      identificationType: 'Online' as never,
      pep: false,
      highRisk: false,
      complexOrgStructure: false,
      kycSteps: [financialStep],
    });
    return {
      userData,
      steps: [financialStep],
      generatedAt,
      nameCheck: Object.assign(new NameCheckLog(), {
        created: new Date('2026-07-31T19:00:00.000Z'),
        riskStatus: NameCheckRiskStatus.NOT_SANCTIONED,
        result: JSON.stringify({ total_hits: 0, found_records: [] }),
      }),
    };
  }

  it.each([
    [FileSubType.GWG_FILE_COVER, 1],
    [FileSubType.DFX_NAME_CHECK, 1],
    [FileSubType.FORM_A, 2],
    [FileSubType.IDENTIFICATION_FORM, 4],
    [FileSubType.CUSTOMER_PROFILE, 2],
    [FileSubType.RISK_PROFILE, 3],
  ])('creates a valid %s PDF with %i page(s)', async (subType, expectedPages) => {
    const pdf = await service.generate(subType, context());
    const source = pdf.toString('latin1');

    expect(source.startsWith('%PDF-')).toBe(true);
    expect(source.match(/\/Type\s*\/Page\b/g)).toHaveLength(expectedPages);
  });

  it.each([
    ['gwg-file-cover.pdf', '8b5e6636a0c1c4c64a1fbe94b77ab12aa5ca8cab072b8ac93190d0ffd6889ace'],
    ['identification-form.pdf', '7e49ae0ffa25962e8cb5319d309733d2581b618a8270183590677ef6f2fcf5c1'],
    ['customer-profile.pdf', 'bbed3c41fbc940b94470d92c58a3d43046547a2b9785d27f935204b0bd017732'],
    ['risk-profile.pdf', '184085521abd00161c5f570b5bfdbc36d400a257fd4650c6f3558baf7eab8e71'],
    ['form-a.pdf', '656bcb34ae66a1479095dd6ff7feda6128d1dc62329606e712e685d765fe3047'],
    ['name-check.pdf', '20a6e3388801c283840d46d79c06f773b40f9a02ad8f9e6b23fe414559d683a8'],
  ])('keeps the productive %s template unchanged', async (fileName, expectedHash) => {
    const template = await readFile(join(__dirname, '../../assets/dfx-approval', fileName));
    expect(createHash('sha256').update(template).digest('hex')).toBe(expectedHash);
  });

  it('uses the productive GSheet file names and date sources', () => {
    const data = context();
    expect(service.fileName(FileSubType.GWG_FILE_COVER, data)).toBe('20260731-GwGFileDeckblatt-0-42-220000.pdf');
    expect(service.fileName(FileSubType.IDENTIFICATION_FORM, data)).toBe(
      '20260731-Identifizierungsformular-0-42-220000.pdf',
    );
    expect(service.fileName(FileSubType.CUSTOMER_PROFILE, data)).toBe('20260731-Kundenprofil-0-42-220000.pdf');
    expect(service.fileName(FileSubType.RISK_PROFILE, data)).toBe('20260731-Risikoprofil-0-42-220000.pdf');
    expect(service.fileName(FileSubType.FORM_A, data)).toBe('20260731-FormularA-0-42-220000.pdf');
    expect(service.fileName(FileSubType.DFX_NAME_CHECK, data)).toBe('20260731-NameCheck-0-42-220000.pdf');
  });

  it.each([
    ['Polish', 'Łukasz Kowalczyk', 'Łódź'],
    ['Turkish', 'Gülşen Şahin', 'Şişli'],
    ['Cyrillic', 'Кузнецов Алексей', 'Москва'],
    ['Baltic', 'Kalniņš Jānis', 'Liepāja'],
  ])('renders %s names, which a WinAnsi standard font cannot encode', async (_language, name, location) => {
    const data = context();
    data.userData.verifiedName = name;
    data.userData.surname = name;
    data.userData.location = location;

    for (const subType of [FileSubType.GWG_FILE_COVER, FileSubType.FORM_A, FileSubType.IDENTIFICATION_FORM]) {
      const pdf = await service.generate(subType, data);
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    }
  });

  it('substitutes characters the font has no glyph for instead of failing the document', async () => {
    const data = context();
    data.userData.verifiedName = '田中太郎';

    const pdf = await service.generate(FileSubType.GWG_FILE_COVER, data);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('keeps the registered file name as document number when a document is regenerated', () => {
    const data = { ...context(), documentName: '20260731-FormularA-0-42-100000.pdf' };

    expect((service as any).documentNumber(FileSubType.FORM_A, data)).toBe('20260731-FormularA-0-42-100000');
  });

  it('replaces cached template values for every dynamic checkbox', async () => {
    const data = context();
    data.userData.sellVolume = 0;
    data.userData.cryptoVolume = 0;
    const uncheck = jest.spyOn(service as any, 'uncheck');
    const check = jest.spyOn(service as any, 'check');

    await service.generate(FileSubType.IDENTIFICATION_FORM, data);
    await service.generate(FileSubType.CUSTOMER_PROFILE, data);
    await service.generate(FileSubType.RISK_PROFILE, data);

    expect(uncheck).toHaveBeenCalledWith(expect.anything(), 239.3, 202.0);
    expect(uncheck).toHaveBeenCalledWith(expect.anything(), 239.3, 219.0);
    expect(uncheck).toHaveBeenCalledWith(expect.anything(), 282.2, 167.5);
    expect(uncheck).toHaveBeenCalledWith(expect.anything(), 282.2, 197.1);
    expect(uncheck).toHaveBeenCalledWith(expect.anything(), 259.4, 150.0);
    expect(uncheck).toHaveBeenCalledWith(expect.anything(), 259.4, 166.7);
    expect(check).not.toHaveBeenCalledWith(expect.anything(), 239.3, 202.0);
    expect(check).not.toHaveBeenCalledWith(expect.anything(), 239.3, 219.0);
    expect(check).not.toHaveBeenCalledWith(expect.anything(), 282.2, 167.5);
    expect(check).not.toHaveBeenCalledWith(expect.anything(), 282.2, 197.1);
  });
});
