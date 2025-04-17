import { BadRequestException, Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Config } from 'src/config/config';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { getFinancialQuestions } from '../../config/financial-questions';
import { KycFinancialResponse } from '../../dto/input/kyc-financial-in.dto';
import { KycFinancialQuestion } from '../../dto/output/kyc-financial-out.dto';
import { QuestionType } from '../../enums/kyc.enum';

@Injectable()
export class FinancialService {
  constructor(private readonly i18n: I18nService) {}

  getQuestions(
    lang: string = Config.defaults.language.toLowerCase(),
    accountType: AccountType,
  ): KycFinancialQuestion[] {
    return getFinancialQuestions(accountType).map((q) => ({
      key: q.key,
      type: q.type,
      title: this.i18n.translate(`kyc.financial.question.${q.i18nKey}.title`, { lang }),
      description: this.i18n.translate(`kyc.financial.question.${q.i18nKey}.description`, { lang }),
      options: q.options?.map((key) => ({ key, text: this.i18n.translate(`kyc.financial.option.${key}`, { lang }) })),
      conditions: q.conditions,
    }));
  }

  isComplete(responses: KycFinancialResponse[], accountType: AccountType): boolean {
    const hasDuplicates = new Set(responses.map((r) => r.key)).size !== responses.length;
    if (hasDuplicates) throw new BadRequestException('Duplicate response keys found');

    return getFinancialQuestions(accountType).every((q) => {
      if (
        q.conditions?.length &&
        !q.conditions?.some((c) => responses.some((r) => r.key === c.question && r.value === c.response))
      )
        return true;

      const response = responses.find((r) => r.key === q.key);
      if (!response?.value) return false;

      const responseValues = q.type === QuestionType.MULTIPLE_CHOICE ? response.value.split(',') : [response.value];
      if (q.options && !responseValues.every((o) => q.options.includes(o)))
        throw new BadRequestException(`Response '${response.value}' for question '${q.key}' is not valid`);

      return true;
    });
  }
}
