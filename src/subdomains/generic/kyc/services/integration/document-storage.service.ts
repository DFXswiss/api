import { Injectable } from '@nestjs/common';
import { AzureStorageService, BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { KycContentType, KycFile, KycFileType } from '../../dto/kyc-file.dto';

@Injectable()
export class DocumentStorageService {
  private readonly storageService: AzureStorageService;

  constructor() {
    this.storageService = new AzureStorageService('kyc');
  }

  async listUserFiles(userDataId: number): Promise<KycFile[]> {
    return this.listFilesByPrefix(`user/${userDataId}/`);
  }

  async listSpiderFiles(userDataId: number, isOrganization: boolean): Promise<KycFile[]> {
    return this.listFilesByPrefix(`spider/${userDataId}${isOrganization ? '-organization' : ''}/`);
  }

  async uploadFile(
    userDataId: number,
    type: KycFileType,
    name: string,
    data: Buffer,
    contentType: KycContentType,
    metadata?: Record<string, string>,
  ): Promise<string> {
    return this.storageService.uploadBlob(this.toFileId(userDataId, type, name), data, contentType, metadata);
  }

  async downloadFile(userDataId: number, type: KycFileType, name: string): Promise<BlobContent> {
    return this.storageService.getBlob(this.toFileId(userDataId, type, name));
  }

  // --- HELPER METHODS --- //
  private async listFilesByPrefix(prefix: string): Promise<KycFile[]> {
    const blobs = await this.storageService.listBlobs(prefix);
    return blobs.map((b) => {
      const [_, type, name] = this.fromFileId(b.name);
      return {
        type,
        name,
        url: b.url,
        contentType: b.contentType as KycContentType,
        created: b.created,
        updated: b.updated,
        metadata: b.metadata,
      };
    });
  }

  private toFileId(userDataId: number, type: KycFileType, name: string): string {
    return `user/${userDataId}/${type}/${name}`;
  }

  private fromFileId(fileId: string): [number, KycFileType, string] {
    const [_, userDataId, type, name] = fileId.split('/');
    return [+userDataId, type as KycFileType, name];
  }
}
