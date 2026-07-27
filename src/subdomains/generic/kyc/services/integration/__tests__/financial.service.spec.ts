import { BadRequestException } from '@nestjs/common';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { KycFinancialResponse } from '../../../dto/input/kyc-financial-in.dto';
import { FinancialService } from '../financial.service';

describe('FinancialService', () => {
  const personalCompleteResponses = (): KycFinancialResponse[] => [
    { key: 'tnc', value: 'accept' },
    { key: 'own_funds', value: 'accept' },
    { key: 'source_of_funds', value: 'employment_income' },
    { key: 'occupation', value: 'employed' },
    { key: 'occupation_description', value: 'Software engineer' },
    { key: 'sector', value: 'it' },
    { key: 'risky_business', value: 'no_risky_business' },
    { key: 'income', value: '50k' },
    { key: 'assets', value: '50k' },
    { key: 'notification_of_changes', value: 'accept' },
  ];

  describe('getMissingFields', () => {
    it('returns empty when all applicable personal questions are answered', () => {
      expect(FinancialService.getMissingFields(personalCompleteResponses(), AccountType.PERSONAL)).toEqual([]);
      expect(FinancialService.isComplete(personalCompleteResponses(), AccountType.PERSONAL)).toBe(true);
    });

    it('lists unanswered applicable question keys', () => {
      const responses: KycFinancialResponse[] = [
        { key: 'tnc', value: 'accept' },
        { key: 'own_funds', value: 'accept' },
      ];

      const missing = FinancialService.getMissingFields(responses, AccountType.PERSONAL);

      expect(missing).toEqual(
        expect.arrayContaining([
          'source_of_funds',
          'occupation',
          'sector',
          'risky_business',
          'income',
          'assets',
          'notification_of_changes',
        ]),
      );
      expect(missing).not.toContain('occupation_description');
      expect(missing).not.toContain('sector_description');
      expect(missing).not.toContain('risky_business_description');
      expect(FinancialService.isComplete(responses, AccountType.PERSONAL)).toBe(false);
    });

    it('does not report a conditional question when its condition is not met', () => {
      const responses: KycFinancialResponse[] = [
        { key: 'tnc', value: 'accept' },
        { key: 'own_funds', value: 'accept' },
        { key: 'source_of_funds', value: 'employment_income' },
        { key: 'occupation', value: 'employed' },
        // occupation_description required (condition met) — omit on purpose below when testing other fields
        { key: 'occupation_description', value: 'Engineer' },
        { key: 'sector', value: 'it' }, // sector_description only when sector=other
        { key: 'risky_business', value: 'no_risky_business' }, // description only when yes
        { key: 'income', value: '50k' },
        { key: 'assets', value: '50k' },
        { key: 'notification_of_changes', value: 'accept' },
      ];

      const missing = FinancialService.getMissingFields(responses, AccountType.PERSONAL);

      expect(missing).toEqual([]);
      expect(missing).not.toContain('sector_description');
      expect(missing).not.toContain('risky_business_description');
    });

    it('reports a conditional question when its condition is met and it is unanswered', () => {
      const responses: KycFinancialResponse[] = [
        { key: 'tnc', value: 'accept' },
        { key: 'own_funds', value: 'accept' },
        { key: 'source_of_funds', value: 'employment_income' },
        { key: 'occupation', value: 'employed' },
        // occupation_description required but missing
        { key: 'sector', value: 'other' },
        // sector_description required but missing
        { key: 'risky_business', value: 'yes_risky_business' },
        // risky_business_description required but missing
        { key: 'income', value: '50k' },
        { key: 'assets', value: '50k' },
        { key: 'notification_of_changes', value: 'accept' },
      ];

      const missing = FinancialService.getMissingFields(responses, AccountType.PERSONAL);

      expect(missing).toEqual(
        expect.arrayContaining(['occupation_description', 'sector_description', 'risky_business_description']),
      );
      expect(FinancialService.isComplete(responses, AccountType.PERSONAL)).toBe(false);
    });

    it('throws on duplicate response keys', () => {
      expect(() =>
        FinancialService.getMissingFields(
          [
            { key: 'tnc', value: 'accept' },
            { key: 'tnc', value: 'accept' },
          ],
          AccountType.PERSONAL,
        ),
      ).toThrow(BadRequestException);
    });

    it('throws on invalid option values when no earlier required answer is missing', () => {
      expect(() =>
        FinancialService.getMissingFields(
          [
            { key: 'tnc', value: 'accept' },
            { key: 'own_funds', value: 'accept' },
            { key: 'source_of_funds', value: 'not_a_valid_option' },
          ],
          AccountType.PERSONAL,
        ),
      ).toThrow(BadRequestException);
    });

    it('does not throw for a later invalid option when an earlier required answer is missing', () => {
      // tnc unanswered first; source_of_funds carries an invalid option later in the catalog.
      // Pre-refactor every() short-circuited on the first missing field and never reached option checks.
      const responses: KycFinancialResponse[] = [
        { key: 'own_funds', value: 'accept' },
        { key: 'source_of_funds', value: 'not_a_valid_option' },
      ];

      expect(() => FinancialService.getMissingFields(responses, AccountType.PERSONAL)).not.toThrow();

      const missing = FinancialService.getMissingFields(responses, AccountType.PERSONAL);
      expect(missing).toContain('tnc');
      expect(missing).toEqual(expect.arrayContaining(['tnc', 'occupation', 'sector', 'income', 'assets']));
    });

    it('still throws when the first answered question with options has an invalid value', () => {
      expect(() =>
        FinancialService.getMissingFields([{ key: 'tnc', value: 'not_a_valid_option' }], AccountType.PERSONAL),
      ).toThrow(BadRequestException);
    });
  });
});
