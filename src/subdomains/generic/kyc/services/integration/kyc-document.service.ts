import { Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { AzureStorageService, BlobContent } from 'src/integration/infrastructure/azure-storage.service';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { FileSubType, FileType, KycFileBlob } from '../../dto/kyc-file.dto';
import { KycFile } from '../../entities/kyc-file.entity';
import { KycStep } from '../../entities/kyc-step.entity';
import { ContentType } from '../../enums/content-type.enum';
import { FileCategory } from '../../enums/file-category.enum';
import { KycFileService } from '../kyc-file.service';

const KYC_CONTAINER = 'kyc';

@Injectable()
export class KycDocumentService {
  private readonly storageService: AzureStorageService;

  constructor(private readonly kycFileService: KycFileService) {
    this.storageService = new AzureStorageService(KYC_CONTAINER);
  }

  async getAllUserDocuments(userDataId: number, accountType = AccountType.PERSONAL): Promise<KycFileBlob[]> {
    return [
      ...(await this.listUserFiles(userDataId)),
      ...(await this.listSpiderFiles(userDataId, false)),
      ...(accountType !== AccountType.PERSONAL ? await this.listSpiderFiles(userDataId, true) : []),
    ];
  }

  // Builds a host-stable URL for a storage path by pinning the host to the services domain
  // (`Config.frontend.services`) while keeping the full storage path (`<container>/<blobName>`)
  // intact. The raw blob URL is `<storage-backend-host>/<container>/<blobName>`; we swap only the
  // host, so a storage-backend migration stays transparent to clients. Path segments are encoded
  // exactly like the raw blob URL (`AzureStorageService.blobUrl`, per-segment `encodeURIComponent`,
  // slashes preserved), so the URL is a true drop-in — identical apart from the host. The path
  // (`<scope>/<id>/<type>`) stays an intact substring, which downstream consumers rely on to extract
  // the file name (e.g. `url.split('<scope>/<id>/<type>')[1]`).
  toHostStableUrl(path: string): string {
    const urlEncodedPath = path.split('/').map(encodeURIComponent).join('/');
    return `${Config.frontend.services}/${KYC_CONTAINER}/${urlEncodedPath}`;
  }

  async listUserFiles(userDataId: number): Promise<KycFileBlob[]> {
    return this.listFilesByPrefix(`user/${userDataId}/`);
  }

  async listSpiderFiles(userDataId: number, isOrganization: boolean): Promise<KycFileBlob[]> {
    return this.listFilesByPrefix(`spider/${userDataId}${isOrganization ? '-organization' : ''}/`);
  }

  async listFilesByPrefixes(prefixes: string[]): Promise<KycFileBlob[]> {
    const files = await Promise.all(prefixes.map((p) => this.listFilesByPrefix(p)));
    return files.flat();
  }

  async listFilesByPrefix(prefix: string): Promise<KycFileBlob[]> {
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
        created: new Date(b.created),
        updated: new Date(b.updated),
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
    subType?: FileSubType,
    metadata?: Record<string, string>,
  ): Promise<{ file: KycFile; url: string }> {
    if (!this.isPermittedFileType(contentType))
      throw new UnsupportedMediaTypeException('Supported file types: PNG, JPEG, JPG, PDF');

    return this.uploadFile(userData, type, name, data, contentType, isProtected, true, kycStep, subType, metadata);
  }

  async uploadFile(
    userData: UserData,
    type: FileType,
    name: string,
    data: Buffer,
    contentType: ContentType,
    isProtected: boolean,
    isValid: boolean,
    kycStep?: KycStep,
    subType?: FileSubType,
    metadata?: Record<string, string>,
  ): Promise<{ file: KycFile; url: string }> {
    const file = await this.kycFileService.createKycFile({
      name,
      type,
      subType,
      protected: isProtected,
      valid: isValid,
      userData,
      kycStep,
    });

    const url = await this.storageService.uploadBlob(
      this.toFileId(FileCategory.USER, userData.id, type, name),
      data,
      contentType,
      metadata,
    );

    return { file, url };
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
