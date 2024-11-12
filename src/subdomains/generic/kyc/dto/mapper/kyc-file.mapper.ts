import { BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { KycFile } from '../../entities/kyc-file.entity';
import { KycFileDataDto } from '../kyc-file.dto';

export class KycFileMapper {
  static mapKycFile(kycFile: KycFile, data: BlobContent): KycFileDataDto {
    const dto: KycFileDataDto = {
      uid: kycFile.uid,
      name: kycFile.name,
      type: kycFile.type,
      contentType: data.contentType,
      content: data.data,
    };

    return Object.assign(new KycFileDataDto(), dto);
  }
}
