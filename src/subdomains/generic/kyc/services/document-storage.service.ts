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

export interface KycFile {
  type: KycFileType;
  name: string;
  contentType: KycContentType;
  created: Date;
  updated: Date;
  metadata: Record<string, string>;
}

@Injectable()
export class DocumentStorageService {
  private readonly storageService: AzureStorageService;

  constructor() {
    this.storageService = new AzureStorageService('kyc');
  }

  async listFiles(userDataId: number): Promise<KycFile[]> {
    const blobs = await this.storageService.listBlobs(`${userDataId}/`);
    return blobs.map((b) => {
      const [_, type, name] = this.fromFileId(b.name);
      return {
        name,
        type,
        contentType: b.contentType as KycContentType,
        created: b.created,
        updated: b.updated,
        metadata: b.metadata,
      };
    });
  }

  async uploadFile(
    userDataId: number,
    type: KycFileType,
    name: string,
    data: Buffer,
    contentType: KycContentType,
    metadata?: Record<string, string>,
  ): Promise<void> {
    await this.storageService.uploadBlob(this.toFileId(userDataId, type, name), data, contentType, metadata);
  }

  async downloadFile(userDataId: number, type: KycFileType, name: string): Promise<BlobContent> {
    return this.storageService.getBlob(this.toFileId(userDataId, type, name));
  }

  // --- HELPER METHODS --- //
  private toFileId(userDataId: number, type: KycFileType, name: string): string {
    return `${userDataId}/${type}/${name}`;
  }

  private fromFileId(fileId: string): [number, KycFileType, string] {
    const [userDataId, type, name] = fileId.split('/');
    return [+userDataId, type as KycFileType, name];
  }
}
