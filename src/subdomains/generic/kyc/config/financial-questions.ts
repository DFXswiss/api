import { AccountType } from '../../user/models/user-data/account-type.enum';
import { QuestionType } from '../enums/kyc.enum';

export interface FinancialQuestion {
  key: string;
  type: QuestionType;
  options?: string[];
  accountTypes?: AccountType[];
  condition?: {
    question: string;
    response: string;
  };
}

export function getFinancialQuestions(accountType: AccountType): FinancialQuestion[] {
  return FinancialQuestions.filter((q) => !q.accountTypes || q.accountTypes.includes(accountType));
}

export const FinancialQuestions: FinancialQuestion[] = [
  {
    key: 'tnc',
    type: QuestionType.CONFIRMATION,
    options: ['accept'],
  },
  {
    key: 'own_funds',
    type: QuestionType.CONFIRMATION,
    options: ['accept'],
    accountTypes: [AccountType.SOLE_PROPRIETORSHIP, AccountType.PERSONAL],
  },
  {
    key: 'own_funds_organization',
    type: QuestionType.CONFIRMATION,
    options: ['accept'],
    accountTypes: [AccountType.ORGANIZATION],
  },
  {
    key: 'source_of_funds',
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
  },
  {
    key: 'operative',
    type: QuestionType.SINGLE_CHOICE,
    options: ['yes', 'no'],
    accountTypes: [AccountType.ORGANIZATION],
  },
  {
    key: 'area',
    type: QuestionType.TEXT,
    accountTypes: [AccountType.SOLE_PROPRIETORSHIP],
  },
  {
    key: 'occupation',
    type: QuestionType.SINGLE_CHOICE,
    options: ['apprentice', 'employed', 'employed_management', 'self_employed', 'unemployed', 'retired', 'privatier'],
    accountTypes: [AccountType.PERSONAL],
  },
  // {
  //   key: 'retired_description',
  //   type: QuestionType.TEXT,
  //   accountTypes: [AccountType.PERSONAL],
  //   condition: {
  //     question: 'occupation',
  //     response: 'retired',
  //   },
  // },
  // {
  //   key: 'unemployed_description',
  //   type: QuestionType.TEXT,
  //   accountTypes: [AccountType.PERSONAL],
  //   condition: {
  //     question: 'occupation',
  //     response: 'unemployed',
  //   },
  // },
  // {
  //   key: 'apprentice_description',
  //   type: QuestionType.TEXT,
  //   accountTypes: [AccountType.PERSONAL],
  //   condition: {
  //     question: 'occupation',
  //     response: 'apprentice',
  //   },
  // },
  // {
  //   key: 'self_employed_description',
  //   type: QuestionType.TEXT,
  //   accountTypes: [AccountType.PERSONAL],
  //   condition: {
  //     question: 'occupation',
  //     response: 'self_employed',
  //   },
  // },
  // {
  //   key: 'privatier_description',
  //   type: QuestionType.TEXT,
  //   accountTypes: [AccountType.PERSONAL],
  //   condition: {
  //     question: 'occupation',
  //     response: 'privatier',
  //   },
  // },
  {
    key: 'employer',
    type: QuestionType.TEXT,
    accountTypes: [AccountType.PERSONAL],
  },
  {
    key: 'sector',
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
  // {
  //   key: 'sector_description',
  //   type: QuestionType.TEXT,
  //   accountTypes: [AccountType.PERSONAL, AccountType.SOLE_PROPRIETORSHIP],
  //   condition: {
  //     question: 'sector',
  //     response: 'other',
  //   },
  // },
  {
    key: 'sector_organization',
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
    key: 'risky_business',
    type: QuestionType.SINGLE_CHOICE,
    options: ['yes_risky_business', 'no_risky_business'],
  },
  // {
  //   key: 'risky_business_description',
  //   type: QuestionType.TEXT,
  //   condition: {
  //     question: 'risky_business',
  //     response: 'yes',
  //   },
  // },
  {
    key: 'income',
    type: QuestionType.SINGLE_CHOICE,
    options: ['50k', '50k_100k', '100k_500k', '500k_1m', '1m'],
  },
  {
    key: 'assets',
    type: QuestionType.SINGLE_CHOICE,
    options: ['50k', '50k_100k', '100k_500k', '500k_1m', '1m'],
  },
  {
    key: 'notification_of_changes',
    type: QuestionType.CONFIRMATION,
    options: ['accept'],
  },
];
