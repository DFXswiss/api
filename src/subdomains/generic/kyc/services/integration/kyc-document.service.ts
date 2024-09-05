import { Injectable } from '@nestjs/common';
import { AzureStorageService, BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { ContentType, FileType, KycFile } from '../../dto/kyc-file.dto';

@Injectable()
export class KycDocumentService {
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

  async listFilesByPrefix(prefix: string): Promise<KycFile[]> {
    const blobs = await this.storageService.listBlobs(prefix);
    return blobs.map((b) => {
      const [_, type, name] = this.fromFileId(b.name);
      return {
        type,
        name,
        url: b.url,
        contentType: b.contentType as ContentType,
        created: b.created,
        updated: b.updated,
        metadata: b.metadata,
      };
    });
  }

  async uploadFile(
    userDataId: number,
    type: FileType,
    name: string,
    data: Buffer,
    contentType: ContentType,
    metadata?: Record<string, string>,
  ): Promise<string> {
    return this.storageService.uploadBlob(this.toFileId(userDataId, type, name), data, contentType, metadata);
  }

  async downloadFile(userDataId: number, type: FileType, name: string): Promise<BlobContent> {
    return this.storageService.getBlob(this.toFileId(userDataId, type, name));
  }

  async copyFiles(sourceUserDataId: number, targetUserDataId: number): Promise<void> {
    await this.storageService.copyBlobs(`spider/${sourceUserDataId}/`, `spider/${targetUserDataId}/`);
    await this.storageService.copyBlobs(
      `spider/${sourceUserDataId}-organization/`,
      `spider/${targetUserDataId}-organization/`,
    );
    await this.storageService.copyBlobs(`user/${sourceUserDataId}/`, `user/${targetUserDataId}/`);
  }

  // --- HELPER METHODS --- //
  private toFileId(userDataId: number, type: FileType, name: string): string {
    return `user/${userDataId}/${type}/${name}`;
  }

  private fromFileId(fileId: string): [number, FileType, string] {
    const [_, userDataId, type, name] = fileId.split('/');
    return [+userDataId, type as FileType, name];
  }
}
