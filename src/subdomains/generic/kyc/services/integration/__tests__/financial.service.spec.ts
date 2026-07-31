import { mock } from 'jest-mock-extended';
import { I18nService } from 'nestjs-i18n';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { getFinancialQuestions } from '../../../config/financial-questions';
import { FinancialService } from '../financial.service';

describe('FinancialService', () => {
  let service: FinancialService;
  const i18n = mock<I18nService>();

  beforeEach(() => {
    jest.clearAllMocks();
    i18n.translate.mockImplementation((key: string) => key);
    service = new FinancialService(i18n);
  });

  describe('getQuestions', () => {
    it('maps conditions from the catalog and omits them when absent', () => {
      const accountType = AccountType.PERSONAL;
      const catalog = getFinancialQuestions(accountType);
      const withConditions = catalog.filter((q) => q.conditions?.length);
      const withoutConditions = catalog.filter((q) => !q.conditions?.length);

      expect(withConditions.length).toBeGreaterThan(0);
      expect(withoutConditions.length).toBeGreaterThan(0);

      const questions = service.getQuestions('en', accountType);

      expect(questions).toHaveLength(catalog.length);

      catalog.forEach((catalogQuestion, index) => {
        const mapped = questions[index];
        expect(mapped.key).toBe(catalogQuestion.key);

        if (catalogQuestion.conditions?.length) {
          expect(mapped.conditions).toEqual(catalogQuestion.conditions);
          for (const condition of mapped.conditions) {
            expect(Object.keys(condition).sort()).toEqual(['question', 'response']);
            expect(typeof condition.question).toBe('string');
            expect(typeof condition.response).toBe('string');
          }
        } else {
          expect(mapped.conditions).toBeUndefined();
        }
      });
    });
  });
});
