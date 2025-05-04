import { AccountType } from '../../user/models/user-data/account-type.enum';
import { QuestionType } from '../enums/kyc.enum';

export interface FinancialQuestion {
  key: string;
  i18nKey: string;
  type: QuestionType;
  options?: string[];
  accountTypes?: AccountType[];
  conditions?: {
    question: string;
    response: string;
  }[];
}

export function getFinancialQuestions(accountType: AccountType): FinancialQuestion[] {
  return FinancialQuestions.filter((q) => !q.accountTypes || q.accountTypes.includes(accountType));
}

export const FinancialQuestions: FinancialQuestion[] = [
  {
    key: 'tnc',
    i18nKey: 'tnc',
    type: QuestionType.CONFIRMATION,
    options: ['accept'],
  },

  {
    key: 'own_funds',
    i18nKey: 'own_funds',
    type: QuestionType.CONFIRMATION,
    options: ['accept'],
    accountTypes: [AccountType.SOLE_PROPRIETORSHIP, AccountType.PERSONAL],
  },
  {
    key: 'own_funds',
    i18nKey: 'own_funds_organization',
    type: QuestionType.CONFIRMATION,
    options: ['accept'],
    accountTypes: [AccountType.ORGANIZATION],
  },

  {
    key: 'source_of_funds',
    i18nKey: 'source_of_funds',
    type: QuestionType.MULTIPLE_CHOICE,
    options: [
      'employment_income',
      'real_estate_sale',
      'share_sale',
      'loan',
      'company_sale',
      'company_profits',
      'inheritance',
      'gift',
      'pension',
      'gambling',
    ],
    accountTypes: [AccountType.SOLE_PROPRIETORSHIP, AccountType.PERSONAL],
  },
  {
    key: 'source_of_funds',
    i18nKey: 'source_of_funds_organization',
    type: QuestionType.MULTIPLE_CHOICE,
    options: ['operations', 'loan', 'company_share_sale', 'company_asset_sale', 'capital_increase'],
    accountTypes: [AccountType.ORGANIZATION],
  },

  {
    key: 'area',
    i18nKey: 'area',
    type: QuestionType.TEXT,
    accountTypes: [AccountType.SOLE_PROPRIETORSHIP],
  },

  {
    key: 'occupation',
    i18nKey: 'occupation',
    type: QuestionType.SINGLE_CHOICE,
    options: ['apprentice', 'employed', 'employed_management', 'self_employed', 'unemployed', 'retired', 'privatier'],
    accountTypes: [AccountType.PERSONAL],
  },
  {
    key: 'occupation_description',
    i18nKey: 'apprentice_description',
    type: QuestionType.TEXT,
    accountTypes: [AccountType.PERSONAL],
    conditions: [
      {
        question: 'occupation',
        response: 'apprentice',
      },
    ],
  },
  {
    key: 'occupation_description',
    i18nKey: 'employed_description',
    type: QuestionType.TEXT,
    accountTypes: [AccountType.PERSONAL],
    conditions: [
      {
        question: 'occupation',
        response: 'employed',
      },
      {
        question: 'occupation',
        response: 'employed_management',
      },
    ],
  },
  {
    key: 'occupation_description',
    i18nKey: 'self_employed_description',
    type: QuestionType.TEXT,
    accountTypes: [AccountType.PERSONAL],
    conditions: [
      {
        question: 'occupation',
        response: 'self_employed',
      },
    ],
  },
  {
    key: 'occupation_description',
    i18nKey: 'unemployed_description',
    type: QuestionType.TEXT,
    accountTypes: [AccountType.PERSONAL],
    conditions: [
      {
        question: 'occupation',
        response: 'unemployed',
      },
    ],
  },
  {
    key: 'occupation_description',
    i18nKey: 'retired_description',
    type: QuestionType.TEXT,
    accountTypes: [AccountType.PERSONAL],
    conditions: [
      {
        question: 'occupation',
        response: 'retired',
      },
    ],
  },
  {
    key: 'occupation_description',
    i18nKey: 'privatier_description',
    type: QuestionType.TEXT,
    accountTypes: [AccountType.PERSONAL],
    conditions: [
      {
        question: 'occupation',
        response: 'privatier',
      },
    ],
  },

  {
    key: 'sector',
    i18nKey: 'sector',
    type: QuestionType.SINGLE_CHOICE,
    options: [
      'no_business',
      'automotive',
      'bank_finance',
      'advisory',
      'education',
      'pharma',
      'it',
      'energy_environment',
      'research_development',
      'health_social_services',
      'trade_consumption',
      'handicraft',
      'real_estate_facility_management',
      'internet_multimedia',
      'culture_entertainment_events',
      'marketing_pr',
      'legal_tax',
      'telecommunication',
      'textile_fashion',
      'traffic_transport_logistics',
      'insurance',
      'other',
    ],
    accountTypes: [AccountType.PERSONAL, AccountType.SOLE_PROPRIETORSHIP],
  },
  {
    key: 'sector',
    i18nKey: 'sector_organization',
    type: QuestionType.SINGLE_CHOICE,
    options: [
      'no_business',
      'automotive',
      'bank_finance',
      'advisory',
      'education',
      'pharma',
      'it',
      'energy_environment',
      'research_development',
      'health_social_services',
      'trade_consumption',
      'handicraft',
      'real_estate_facility_management',
      'internet_multimedia',
      'culture_entertainment_events',
      'marketing_pr',
      'legal_tax',
      'telecommunication',
      'textile_fashion',
      'traffic_transport_logistics',
      'insurance',
      'other',
    ],
    accountTypes: [AccountType.ORGANIZATION],
  },

  {
    key: 'sector_description',
    i18nKey: 'sector_description',
    type: QuestionType.TEXT,
    conditions: [
      {
        question: 'sector',
        response: 'other',
      },
    ],
  },

  {
    key: 'risky_business',
    i18nKey: 'risky_business',
    type: QuestionType.SINGLE_CHOICE,
    options: ['yes_risky_business', 'no_risky_business'],
    accountTypes: [AccountType.SOLE_PROPRIETORSHIP, AccountType.PERSONAL],
  },
  {
    key: 'risky_business',
    i18nKey: 'risky_business_organization',
    type: QuestionType.SINGLE_CHOICE,
    options: ['yes_risky_business', 'no_risky_business'],
    accountTypes: [AccountType.ORGANIZATION],
  },
  {
    key: 'risky_business_description',
    i18nKey: 'risky_business_description',
    type: QuestionType.TEXT,
    conditions: [
      {
        question: 'risky_business',
        response: 'yes_risky_business',
      },
    ],
  },

  {
    key: 'income',
    i18nKey: 'income',
    type: QuestionType.SINGLE_CHOICE,
    options: ['50k', '50k_100k', '100k_500k', '500k_1m', '1m'],
    accountTypes: [AccountType.SOLE_PROPRIETORSHIP, AccountType.PERSONAL],
  },
  {
    key: 'income',
    i18nKey: 'income_organization',
    type: QuestionType.SINGLE_CHOICE,
    options: ['50k', '50k_100k', '100k_500k', '500k_1m', '1m'],
    accountTypes: [AccountType.ORGANIZATION],
  },

  {
    key: 'assets',
    i18nKey: 'assets',
    type: QuestionType.SINGLE_CHOICE,
    options: ['50k', '50k_100k', '100k_500k', '500k_1m', '1m'],
    accountTypes: [AccountType.SOLE_PROPRIETORSHIP, AccountType.PERSONAL],
  },
  {
    key: 'assets',
    i18nKey: 'assets_organization',
    type: QuestionType.SINGLE_CHOICE,
    options: ['50k', '50k_100k', '100k_500k', '500k_1m', '1m'],
    accountTypes: [AccountType.ORGANIZATION],
  },

  {
    key: 'notification_of_changes',
    i18nKey: 'notification_of_changes',
    type: QuestionType.CONFIRMATION,
    options: ['accept'],
  },
];
