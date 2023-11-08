import { Injectable } from '@nestjs/common';
import { AzureStorageService, BlobContent } from 'src/integration/infrastructure/azure-storage.service';

// TODO: move to separate file
export enum KycFileType {
  NAME_CHECK = 'NameCheck',
  USER_INFORMATION = 'UserInformation',
  IDENTIFICATION = 'Identification',
  USER_NOTES = 'UserNotes',
  TRANSACTION_NOTES = 'TransactionNotes',
}

export enum KycContentType {
  TEXT = 'text/plain',
  // TODO
}

export interface KycDocument {
  type: KycFileType;
  name: string;
  contentType: KycContentType;
  created: Date;
  updated: Date;
}

@Injectable()
export class DocumentStorageService {
  private readonly storageService: AzureStorageService;

  constructor() {
    this.storageService = new AzureStorageService('kyc');
  }

  async listFiles(userDataId: number): Promise<KycDocument[]> {
    const blobs = await this.storageService.listBlobs(`${userDataId}`);
    return blobs.map((b) => {
      const [_, type, name] = b.name.split('/');
      return {
        name,
        type: type as KycFileType,
        contentType: b.contentType as KycContentType,
        created: b.created,
        updated: b.updated,
      };
    });
  }

  async uploadFile(
    userDataId: number,
    type: KycFileType,
    name: string,
    data: Buffer,
    contentType: KycContentType,
  ): Promise<void> {
    await this.storageService.uploadBlob(this.fileId(userDataId, type, name), data, contentType);
  }

  async downloadFile(userDataId: number, type: KycFileType, name: string): Promise<BlobContent> {
    return this.storageService.getBlob(this.fileId(userDataId, type, name));
  }

  // --- HELPER METHODS --- //
  private fileId(userDataId: number, type: KycFileType, name: string): string {
    return `${userDataId}/${type}/${name}`;
  }
}
