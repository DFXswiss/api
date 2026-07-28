import { DfxLogger } from 'src/shared/services/dfx-logger';
import { RequiredKycField } from 'src/subdomains/generic/user/models/user-data/user-data.entity';

const logger = new DfxLogger('PersonalDataMissingFields');

/**
 * Maps UserData entity field names to KycPersonalData request paths for submit feedback.
 * `string` = request path; `null` = known required field that is not reportable here
 * (e.g. mail is owned by the ContactData step).
 *
 * Typed as Record over RequiredKycField so adding a field to requiredKycFields breaks the build
 * until a mapping entry is added.
 */
const PERSONAL_DATA_ENTITY_TO_REQUEST: Record<RequiredKycField, string | null> = {
  accountType: 'accountType',
  mail: null,
  phone: 'phone',
  firstname: 'firstName',
  surname: 'lastName',
  street: 'address.street',
  location: 'address.city',
  zip: 'address.zip',
  country: 'address.country',
  organizationName: 'organizationName',
  organizationStreet: 'organizationAddress.street',
  organizationLocation: 'organizationAddress.city',
  organizationZip: 'organizationAddress.zip',
  organizationCountry: 'organizationAddress.country',
};

function isRequiredKycField(field: string): field is RequiredKycField {
  return Object.prototype.hasOwnProperty.call(PERSONAL_DATA_ENTITY_TO_REQUEST, field);
}

export function toPersonalDataMissingFields(entityFields: readonly string[]): string[] {
  const paths: string[] = [];

  for (const field of entityFields) {
    if (!isRequiredKycField(field)) {
      logger.error(`Unknown KYC field in personal-data completeness mapping: ${field}`);
      continue;
    }

    const path = PERSONAL_DATA_ENTITY_TO_REQUEST[field];
    // null = known but not reportable on this endpoint (e.g. mail → ContactData)
    if (path != null) paths.push(path);
  }

  return paths;
}
