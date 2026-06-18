import { Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import { ArchiveService } from 'src/integration/infrastructure/storage/anchoring/archive.service';
import { sha256 } from 'src/integration/infrastructure/storage/anchoring/merkle';
import { createStorageService } from 'src/integration/infrastructure/storage/storage.factory';
import { BlobContent, StorageService } from 'src/integration/infrastructure/storage/storage.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { FileSubType, FileType, KycFileBlob } from '../../dto/kyc-file.dto';
import { KycFile } from '../../entities/kyc-file.entity';
import { KycStep } from '../../entities/kyc-step.entity';
import { ContentType } from '../../enums/content-type.enum';
import { FileCategory } from '../../enums/file-category.enum';
import { KycFileService } from '../kyc-file.service';

@Injectable()
export class KycDocumentService {
  private static readonly bucket = 'kyc';

  private readonly logger = new DfxLogger(KycDocumentService);

  private readonly storageService: StorageService;

  constructor(
    private readonly kycFileService: KycFileService,
    private readonly archiveService: ArchiveService,
  ) {
    this.storageService = createStorageService(KycDocumentService.bucket);
  }

  async getAllUserDocuments(userDataId: number, accountType = AccountType.PERSONAL): Promise<KycFileBlob[]> {
    return [
      ...(await this.listUserFiles(userDataId)),
      ...(await this.listSpiderFiles(userDataId, false)),
      ...(accountType !== AccountType.PERSONAL ? await this.listSpiderFiles(userDataId, true) : []),
    ];
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

    const blobName = this.toFileId(FileCategory.USER, userData.id, type, name);

    const url = await this.storageService.uploadBlob(blobName, data, contentType, metadata);

    // GeBüV anchoring (Stage 3): record the content hash of the just-uploaded KYC document
    // (a retention-relevant compliance bucket) so it can later be Merkle-batched and anchored.
    // This is a best-effort side-booking: the upload above has already succeeded and must not
    // be rolled back if hash recording fails, so failures are logged (never silently swallowed)
    // but not rethrown.
    try {
      await this.archiveService.recordHash(KycDocumentService.bucket, blobName, sha256(data).toString('hex'));
    } catch (e) {
      this.logger.error(`GeBüV anchoring failed to record hash for ${KycDocumentService.bucket}/${blobName}:`, e);
    }

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
