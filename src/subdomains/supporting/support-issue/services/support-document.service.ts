import { Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import { AzureStorageService, Blob, BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';

export interface SupportFile extends Blob {
  userDataId: number;
  issueId: number;
  contentType: ContentType;
}

@Injectable()
export class SupportDocumentService {
  private readonly storageService: AzureStorageService;

  constructor() {
    this.storageService = new AzureStorageService('support');
  }

  async listFilesByPrefix(prefix: string): Promise<SupportFile[]> {
    const blobs = await this.storageService.listBlobs(prefix);
    return blobs.map((b) => {
      const [userDataId, issueId, name] = this.fromFileId(b.name);
      return {
        userDataId,
        issueId,
        name,
        url: b.url,
        contentType: b.contentType as ContentType,
        created: b.created,
        updated: b.updated,
        metadata: b.metadata,
      };
    });
  }

  async uploadUserFile(
    userDataId: number,
    issueId: number,
    name: string,
    data: Buffer,
    contentType: ContentType,
    metadata?: Record<string, string>,
  ): Promise<string> {
    if (!this.isPermittedFileType(contentType))
      throw new UnsupportedMediaTypeException('Supported file types: PNG, JPEG, JPG, PDF');

    return this.uploadFile(userDataId, issueId, name, data, contentType, metadata);
  }

  async uploadFile(
    userDataId: number,
    issueId: number,
    name: string,
    data: Buffer,
    contentType: ContentType,
    metadata?: Record<string, string>,
  ): Promise<string> {
    return this.storageService.uploadBlob(this.toFileId(userDataId, issueId, name), data, contentType, metadata);
  }

  async downloadFile(userDataId: number, issueId: number, name: string): Promise<BlobContent> {
    return this.storageService.getBlob(this.toFileId(userDataId, issueId, name));
  }

  // --- HELPER METHODS --- //
  private toFileId(userDataId: number, issueId: number, name: string): string {
    return `user/${userDataId}/issues/${issueId}/${name}`;
  }

  private fromFileId(fileId: string): [number, number, string] {
    const [_u, userDataId, _i, issueId, name] = fileId.split('/');
    return [+userDataId, +issueId, name];
  }

  private isPermittedFileType(fileType: ContentType): boolean {
    return [ContentType.PNG, ContentType.JPEG, ContentType.JPG, ContentType.PDF].includes(fileType);
  }
}
