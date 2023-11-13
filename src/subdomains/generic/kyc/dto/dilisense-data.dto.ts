export class DilisenseJsonData {
  sourceId: string;
  sourceType: string;
  pepType?: string;
  id: string;
  entityType: string;
  gender?: string;
  name: string;
  lastNames?: string[];
  givenNames?: string[];
  aliasNames?: string[];
  address?: string[];
  dateOfBirth?: string[];
  placeOfBirth?: string[];
  citizenship?: string[];
  description?: string[];
  occupations?: string[];
  positions?: string[];
  politicalParties?: string[];
  links: string[];
  otherInformation?: string[];
  sanctionDetails?: string[];
}

export class DilisenseApiData {
  timestamp: string;
  total_hits: number;
  found_records?: DilisenseRecordData[];
}

enum SourceType {
  SANCTION = 'Sanction',
  PEP = 'Pep',
  CRIMINAL = 'Criminal',
  OTHER = 'Other',
}

enum PepType {
  POLITICIAN = 'Politician',
  JUDGE = 'Judge',
  BOARD_MEMBER_OF_CENTRAL_BANK = 'BoardMemberOfCentralBank',
  EXECUTIVE_AUDITOR = 'ExecutiveAuditor',
  ADMINISTRATION_OFFICE_EXECUTIVE = 'AdministrationOfficeExecutive',
  MILITARY_OFFICIAL = 'MilitaryOfficial',
  EMBASSY_OFFICIAL = 'EmbassyOfficial',
  INTERNATIONAL_ORGANIZATION_OFFICIAL = 'InternationalOrganizationOfficial',
  RELATIVES_AND_CLOSE_ASSOCIATES = 'RelativesAndCloseAssociates',
  STATE_OWNED_ENTERPRISE = 'StateOwnedEnterprise',
  BOARD_MEMBER_OF_STATE_OWNED_ENTERPRISE = 'BoardMemberOfStateOwnedEnterprise',
  PROSECUTION_OFFICIAL = 'ProsecutionOfficial',
  AGENCY_OFFICIAL = 'AgencyOfficial',
  OTHER = 'Other',
}

class DilisenseRecordData {
  source_type: SourceType;
  pep_type: PepType;
  source_id: string;
  id: string;
  entity_type: string;
  list_date: number;
  gender: string;
  name: string;
  tl_name: string;
  alias_names: string[];
  last_names: string[];
  given_names: string[];
  alias_given_names: string[];
  name_remarks: string[];
  spouse: string[];
  parents: string[];
  children: string[];
  siblings: string[];
  date_of_birth: string[];
  date_of_birth_remarks: string[];
  place_of_birth: string[];
  place_of_birth_remarks: string[];
  address: string[];
  address_remarks: string[];
  citizenship: string[];
  citizenship_remarks: string[];
  sanction_details: string[];
  description: string[];
  occupations: string[];
  positions: string[];
  political_parties: string[];
  links: string[];
  titles: string[];
  functions: string[];
  other_information: string[];
}
