import { Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import { AzureStorageService, BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { FileCategory, FileType, KycFile } from '../../dto/kyc-file.dto';
import { KycStep } from '../../entities/kyc-step.entity';
import { ContentType } from '../../enums/content-type.enum';
import { KycFileService } from '../kyc-file.service';

@Injectable()
export class KycDocumentService {
  private readonly storageService: AzureStorageService;

  constructor(private readonly kycFileService: KycFileService) {
    this.storageService = new AzureStorageService('kyc');
  }

  async listUserFiles(userDataId: number): Promise<KycFile[]> {
    return this.listFilesByPrefix(`user/${userDataId}/`);
  }

  async listSpiderFiles(userDataId: number, isOrganization: boolean): Promise<KycFile[]> {
    return this.listFilesByPrefix(`spider/${userDataId}${isOrganization ? '-organization' : ''}/`);
  }

  async listFilesByPrefixes(prefixes: string[]): Promise<KycFile[]> {
    const files = await Promise.all(prefixes.map((p) => this.listFilesByPrefix(p)));
    return files.flat();
  }

  async listFilesByPrefix(prefix: string): Promise<KycFile[]> {
    const blobs = await this.storageService.listBlobs(prefix);
    return blobs.map((b) => {
      const [category, _, type, name] = this.fromFileId(b.name);
      return {
        category,
        type,
        name,
        path: b.name,
        url: b.url,
        contentType: b.contentType as ContentType,
        created: b.created,
        updated: b.updated,
        metadata: b.metadata,
      };
    });
  }

  async uploadUserFile(
    userData: UserData,
    type: FileType,
    name: string,
    data: Buffer,
    contentType: ContentType,
    isProtected: boolean,
    kycStep?: KycStep,
    metadata?: Record<string, string>,
  ): Promise<string> {
    if (!this.isPermittedFileType(contentType))
      throw new UnsupportedMediaTypeException('Supported file types: PNG, JPEG, JPG, PDF');

    return this.uploadFile(userData, type, name, data, contentType, isProtected, kycStep, metadata);
  }

  async uploadFile(
    userData: UserData,
    type: FileType,
    name: string,
    data: Buffer,
    contentType: ContentType,
    isProtected: boolean,
    kycStep?: KycStep,
    metadata?: Record<string, string>,
  ): Promise<string> {
    await this.kycFileService.createKycFile({
      name: name,
      type: type,
      protected: isProtected,
      userData,
      kycStep,
    });

    return this.storageService.uploadBlob(
      this.toFileId(FileCategory.USER, userData.id, type, name),
      data,
      contentType,
      metadata,
    );
  }

  async downloadFile(category: FileCategory, userDataId: number, type: FileType, name: string): Promise<BlobContent> {
    return this.storageService.getBlob(this.toFileId(category, userDataId, type, name));
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
  private toFileId(category: FileCategory, userDataId: number, type: FileType, name: string): string {
    return `${category}/${userDataId}/${type}/${name}`;
  }

  private fromFileId(fileId: string): [FileCategory, number, FileType, string] {
    const [category, userDataId, type, ...names] = fileId.split('/');
    return [category as FileCategory, +userDataId, type as FileType, names.join('/')];
  }

  private isPermittedFileType(fileType: ContentType): boolean {
    return [ContentType.PNG, ContentType.JPEG, ContentType.JPG, ContentType.PDF].includes(fileType);
  }
}
