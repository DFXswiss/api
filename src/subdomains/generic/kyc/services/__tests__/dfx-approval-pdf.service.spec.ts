import { createCustomCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { createDefaultLanguage } from 'src/shared/models/language/__mocks__/language.entity.mock';
import { AccountType } from '../../../user/models/user-data/account-type.enum';
import { createCustomUserData } from '../../../user/models/user-data/__mocks__/user-data.entity.mock';
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
    [FileSubType.FORM_A, 1],
    [FileSubType.IDENTIFICATION_FORM, 4],
    [FileSubType.CUSTOMER_PROFILE, 2],
    [FileSubType.RISK_PROFILE, 3],
  ])('creates a valid %s PDF with %i page(s)', async (subType, expectedPages) => {
    const pdf = await service.generate(subType, context());
    const source = pdf.toString('latin1');

    expect(source.startsWith('%PDF-')).toBe(true);
    expect(source.match(/\/Type\s*\/Page\b/g)).toHaveLength(expectedPages);
  });
});
