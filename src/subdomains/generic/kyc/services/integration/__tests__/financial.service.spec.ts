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

  const organizationCompleteResponses = (): KycFinancialResponse[] => [
    { key: 'tnc', value: 'accept' },
    { key: 'own_funds', value: 'accept' },
    { key: 'source_of_funds', value: 'operations' },
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
      // sector=it / risky_business=no → descriptions not applicable; omit income so the list is non-empty
      const responses: KycFinancialResponse[] = [
        { key: 'tnc', value: 'accept' },
        { key: 'own_funds', value: 'accept' },
        { key: 'source_of_funds', value: 'employment_income' },
        { key: 'occupation', value: 'employed' },
        { key: 'occupation_description', value: 'Engineer' },
        { key: 'sector', value: 'it' },
        { key: 'risky_business', value: 'no_risky_business' },
        { key: 'assets', value: '50k' },
        { key: 'notification_of_changes', value: 'accept' },
      ];

      const missing = FinancialService.getMissingFields(responses, AccountType.PERSONAL);

      expect(missing).toContain('income');
      expect(missing).not.toContain('sector_description');
      expect(missing).not.toContain('risky_business_description');
    });

    it('reports a conditional question when its condition is met and it is unanswered', () => {
      const responses: KycFinancialResponse[] = [
        { key: 'tnc', value: 'accept' },
        { key: 'own_funds', value: 'accept' },
        { key: 'source_of_funds', value: 'employment_income' },
        { key: 'occupation', value: 'employed' },
        { key: 'sector', value: 'other' },
        { key: 'risky_business', value: 'yes_risky_business' },
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

    it('returns empty for a complete organization questionnaire', () => {
      expect(FinancialService.getMissingFields(organizationCompleteResponses(), AccountType.ORGANIZATION)).toEqual([]);
      expect(FinancialService.isComplete(organizationCompleteResponses(), AccountType.ORGANIZATION)).toBe(true);
    });

    it('lists missing organization keys without personal-only occupation questions', () => {
      const responses: KycFinancialResponse[] = [
        { key: 'tnc', value: 'accept' },
        { key: 'own_funds', value: 'accept' },
      ];

      const missing = FinancialService.getMissingFields(responses, AccountType.ORGANIZATION);

      expect(missing).toEqual(
        expect.arrayContaining([
          'source_of_funds',
          'sector',
          'risky_business',
          'income',
          'assets',
          'notification_of_changes',
        ]),
      );
      expect(missing).not.toContain('occupation');
      expect(missing).not.toContain('occupation_description');
      expect(FinancialService.isComplete(responses, AccountType.ORGANIZATION)).toBe(false);
    });

    it('accepts a valid multi-value multiple-choice answer', () => {
      const responses = personalCompleteResponses().map((r) =>
        r.key === 'source_of_funds' ? { key: 'source_of_funds', value: 'employment_income,pension' } : r,
      );

      expect(FinancialService.getMissingFields(responses, AccountType.PERSONAL)).toEqual([]);
      expect(FinancialService.isComplete(responses, AccountType.PERSONAL)).toBe(true);
    });

    it('throws when a multi-value multiple-choice answer contains an invalid option', () => {
      expect(() =>
        FinancialService.getMissingFields(
          [
            { key: 'tnc', value: 'accept' },
            { key: 'own_funds', value: 'accept' },
            { key: 'source_of_funds', value: 'employment_income,not_a_valid_option' },
          ],
          AccountType.PERSONAL,
        ),
      ).toThrow(BadRequestException);
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
