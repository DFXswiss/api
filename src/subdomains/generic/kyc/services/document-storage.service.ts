import { Injectable } from '@nestjs/common';
import { AzureStorageService, BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { KycContentType, KycDocument } from '../../user/services/spider/dto/spider.dto';

// TODO: move to separate file
export enum KycFileType {
  NAME_CHECK = 'NameCheck',
  USER_INFORMATION = 'UserInformation',
  IDENTIFICATION = 'Identification',
  USER_NOTES = 'UserNotes',
  TRANSACTION_NOTES = 'TransactionNotes',
}

export interface KycFile {
  type: KycFileType;
  name: string;
  version: string;
  contentType: KycContentType;
  created: Date;
  updated: Date;
  metadata: { [propertyName: string]: string };
}

@Injectable()
export class DocumentStorageService {
  private readonly storageService: AzureStorageService;

  constructor() {
    this.storageService = new AzureStorageService('kyc');
  }

  async listFiles(userDataId: number): Promise<KycFile[]> {
    const blobs = await this.storageService.listBlobs(`${userDataId}`);
    return blobs.map((b) => {
      const [_, type, version, name] = b.name.split('/');
      return {
        name,
        version,
        type: type as KycFileType,
        contentType: b.contentType as KycContentType,
        created: b.created,
        updated: b.updated,
        metadata: b.metadata,
      };
    });
  }

  async uploadFile(
    userDataId: number,
    type: KycDocument,
    version: string,
    name: string,
    data: Buffer,
    contentType: KycContentType,
    metadata: any,
  ): Promise<void> {
    await this.storageService.uploadBlob(this.fileId(userDataId, type, version, name), data, contentType, metadata);
  }

  async downloadFile(userDataId: number, type: KycDocument, version: string, name: string): Promise<BlobContent> {
    return this.storageService.getBlob(this.fileId(userDataId, type, name, version));
  }

  // --- HELPER METHODS --- //
  private fileId(userDataId: number, type: KycDocument, version: string, name: string): string {
    return `${userDataId}/${type}/${version}/${name.split('/').join('_')}`;
  }
}
