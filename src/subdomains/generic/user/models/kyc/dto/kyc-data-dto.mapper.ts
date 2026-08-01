import { getKycWebhookStatus } from 'src/subdomains/generic/user/services/webhook/mapper/webhook-data.mapper';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { KycDataDto } from 'src/subdomains/generic/user/models/kyc/dto/kyc-data.dto';

/**
 * The per-user entry `GET /kyc/users` answers with.
 *
 * Kept here rather than in `KycService` so the projection spec can drive the same mapping the endpoint uses; a
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
