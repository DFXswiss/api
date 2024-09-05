import { Injectable } from '@nestjs/common';
import { AzureStorageService, Blob, BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { ContentType } from '../../dto/kyc-file.dto';

export interface SupportFile extends Blob {
  userDataId: number;
  ticketId: number;
  contentType: ContentType;
}

@Injectable()
export class KycDocumentService {
  private readonly storageService: AzureStorageService;

  constructor() {
    this.storageService = new AzureStorageService('support');
  }

  async listFilesByPrefix(prefix: string): Promise<SupportFile[]> {
    const blobs = await this.storageService.listBlobs(prefix);
    return blobs.map((b) => {
      const [userDataId, ticketId, name] = this.fromFileId(b.name);
      return {
        userDataId,
        ticketId,
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
    ticketId: number,
    name: string,
    data: Buffer,
    contentType: ContentType,
    metadata?: Record<string, string>,
  ): Promise<string> {
    return this.storageService.uploadBlob(this.toFileId(userDataId, ticketId, name), data, contentType, metadata);
  }

  async downloadFile(userDataId: number, ticketId: number, name: string): Promise<BlobContent> {
    return this.storageService.getBlob(this.toFileId(userDataId, ticketId, name));
  }

  // --- HELPER METHODS --- //
  private toFileId(userDataId: number, ticketId: number, name: string): string {
    return `user/${userDataId}/issues/${ticketId}/${name}`;
  }

  private fromFileId(fileId: string): [number, number, string] {
    const [_u, userDataId, _i, ticketId, name] = fileId.split('/');
    return [+userDataId, +ticketId, name];
  }
}
