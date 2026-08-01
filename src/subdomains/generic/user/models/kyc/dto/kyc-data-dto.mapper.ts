import { getKycWebhookStatus } from 'src/subdomains/generic/user/services/webhook/mapper/webhook-data.mapper';
import { User } from '../../user/user.entity';
import { KycDataDto } from './kyc-data.dto';

/**
 * The per-user entry `GET /kyc/users` answers with.
 *
 * Moved out of `KycService` so the projection spec can drive the same mapping the endpoint uses; a
 * copy in the spec could be wrong in exactly the way the projection is wrong.
 */
export class KycDataDtoMapper {
  static toDto(user: User): KycDataDto {
    return {
      id: user.address,
      kycStatus: getKycWebhookStatus(user.userData.kycStatus, user.userData.kycType),
      kycHash: user.userData.kycHash,
    };
  }
}
