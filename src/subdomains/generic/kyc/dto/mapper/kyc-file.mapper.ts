import { KycFile } from '../../entities/kyc-file.entity';
import { KycFileDataDto } from '../kyc-file.dto';

export class KycFileMapper {
  static mapKycFile(kycFile: KycFile, data: Buffer): KycFileDataDto {
    const dto: KycFileDataDto = {
      uid: kycFile.uid,
      name: kycFile.name,
      type: kycFile.type,
      data: data,
    };

    return Object.assign(new KycFileDataDto(), dto);
  }
}
