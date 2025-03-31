import { QuestionType } from '../enums/kyc.enum';

export interface FinancialQuestion {
  key: string;
  type: QuestionType;
  options?: string[];
}

export const FinancialQuestions: FinancialQuestion[] = [
  { key: 'tnc', type: QuestionType.CONFIRMATION, options: ['accept'] },
  { key: 'own_funds', type: QuestionType.CONFIRMATION, options: ['accept'] },
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
    key: 'occupation',
    type: QuestionType.SINGLE_CHOICE,
    options: ['apprentice', 'employed', 'employed_management', 'self_employed', 'unemployed', 'retired', 'privatier'],
  },
  { key: 'employer', type: QuestionType.TEXT },
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
  },
  { key: 'risky_business', type: QuestionType.SINGLE_CHOICE, options: ['yes_risky_business', 'no_risky_business'] },
  { key: 'income', type: QuestionType.SINGLE_CHOICE, options: ['50k', '50k_100k', '100k_500k', '500k_1m', '1m'] },
  { key: 'assets', type: QuestionType.SINGLE_CHOICE, options: ['50k', '50k_100k', '100k_500k', '500k_1m', '1m'] },
  { key: 'notification_of_changes', type: QuestionType.CONFIRMATION, options: ['accept'] },
];
