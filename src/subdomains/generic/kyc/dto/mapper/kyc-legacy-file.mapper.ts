import { FileSubType, FileType } from '../kyc-file.dto';
import { LegacyFileEntry, LegacyFileMapping, LegacyFileSkipReason } from '../kyc-legacy-file.dto';

// Legacy KYC documents from the Spider era are stored under `spider/<userDataId>/…` (and
// `spider/<userDataId>-organization/…` for the business documents of the same account), a layout that
// predates the `kyc_file` catalog. This mapper decides, for the blob keys of one such owner, which of
// them are customer documents, which file type they carry and under which name they are catalogued.

const SPIDER_SCOPE = 'spider';
const ORGANIZATION_SUFFIX = '-organization';
const CHECK_FOLDER = 'check';
const CHECK_RUN_PATTERN = /^gen_(\d+)$/;
const IDENT_FOLDERS = ['online-identification', 'video_identification'];

// Everything else stored next to the documents is a machine artifact of the Spider run (raw provider
// payloads, mails, archives, office formats) and is not a customer document.
const DOCUMENT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'mp3', 'mp4'];
const RECORDING_EXTENSIONS = ['mp3', 'mp4'];

// The ident provider named the selfie and liveness captures by purpose; the remaining images are shots
// of the identity document itself.
const SELFIE_NAME_PATTERN = /userface|liveness|security/i;

const FolderTypeMap: { [folder: string]: { type: FileType; subType?: FileSubType } } = {
  passport_or_id: { type: FileType.IDENTIFICATION, subType: FileSubType.IDENT_DOC },
  'chatbot-onboarding': { type: FileType.USER_NOTES, subType: FileSubType.ONBOARDING_REPORT },
  'user-added-document': { type: FileType.USER_NOTES },
  incorporation_certificate: { type: FileType.COMMERCIAL_REGISTER },
  registry_commerce: { type: FileType.COMMERCIAL_REGISTER },
};

interface LegacyFilePath {
  key: string;
  owner: string;
  isOrganization: boolean;
  folder: string;
  segments: string[];
  name: string;
  extension: string;
}

export class KycLegacyFileMapper {
  // Maps the blob keys of one Spider owner — the personal and the organization prefix of the same
  // account — to catalog rows, together with the reason for every key that is not catalogued.
  static toCatalogEntries(userDataId: number, keys: string[]): LegacyFileMapping {
    const skipped: LegacyFileSkipReason[] = [];
    const documents: LegacyFilePath[] = [];

    // Sorted so name collisions are resolved in a stable order, whatever order the listing returned.
    for (const key of [...keys].sort()) {
      const path = this.parsePath(userDataId, key);
      if (!path) {
        skipped.push(LegacyFileSkipReason.INVALID_PATH);
        continue;
      }

      if (!DOCUMENT_EXTENSIONS.includes(path.extension)) {
        skipped.push(LegacyFileSkipReason.UNSUPPORTED_EXTENSION);
        continue;
      }

      documents.push(path);
    }

    const newestCheckRuns = this.newestCheckRuns(documents);
    const entries: LegacyFileEntry[] = [];
    const paths: LegacyFilePath[] = [];

    for (const path of documents) {
      // A name check was re-run over the years and every run was kept; only the most recent one
      // describes the account as it stands, so earlier runs stay out of the catalog.
      if (path.folder === CHECK_FOLDER) {
        const run = this.checkRun(path.segments);
        if (run != null && run !== newestCheckRuns.get(path.owner)) {
          skipped.push(LegacyFileSkipReason.SUPERSEDED_NAME_CHECK);
          continue;
        }
      }

      const { type, subType } = this.toFileType(path);
      entries.push({ userDataId, name: path.name, type, subType, path: path.key });
      paths.push(path);
    }

    this.resolveNameCollisions(entries, paths);

    return { entries, skipped };
  }

  // --- HELPER METHODS --- //

  private static parsePath(userDataId: number, key: string): LegacyFilePath | undefined {
    const [scope, owner, ...segments] = key.split('/');
    const name = segments[segments.length - 1];

    const isOwnerOfUserData = owner === `${userDataId}` || owner === `${userDataId}${ORGANIZATION_SUFFIX}`;
    if (scope !== SPIDER_SCOPE || !isOwnerOfUserData || !name) return undefined;

    // A key without an extension carries no file kind and is filtered like any other non-document.
    const extensionIndex = name.lastIndexOf('.');

    return {
      key,
      owner,
      isOrganization: owner.endsWith(ORGANIZATION_SUFFIX),
      folder: segments.length > 1 ? segments[0] : '',
      segments,
      name,
      extension: extensionIndex > 0 ? name.substring(extensionIndex + 1).toLowerCase() : '',
    };
  }

  private static toFileType(path: LegacyFilePath): { type: FileType; subType?: FileSubType } {
    if (path.folder === CHECK_FOLDER)
      return {
        type: FileType.NAME_CHECK,
        subType: path.isOrganization ? FileSubType.BUSINESS_NAME_CHECK : FileSubType.PERSONAL_NAME_CHECK,
      };

    if (IDENT_FOLDERS.includes(path.folder)) return { type: FileType.IDENTIFICATION, subType: this.identSubType(path) };

    // A folder without a known meaning is catalogued as an additional document rather than dropped: the
    // file is a customer document either way, only its classification is unknown.
    return FolderTypeMap[path.folder] ?? { type: FileType.ADDITIONAL_DOCUMENTS };
  }

  private static identSubType(path: LegacyFilePath): FileSubType {
    if (path.extension === 'pdf') return FileSubType.IDENT_REPORT;
    if (RECORDING_EXTENSIONS.includes(path.extension)) return FileSubType.IDENT_RECORDING;

    return SELFIE_NAME_PATTERN.test(path.name) ? FileSubType.IDENT_SELFIE : FileSubType.IDENT_DOC;
  }

  // Highest `check/gen_<number>/` run per owner prefix, counted over the keys that are documents at all
  // — a run whose files were all filtered out cannot supersede the last run that still has some.
  private static newestCheckRuns(paths: LegacyFilePath[]): Map<string, number> {
    const runs = new Map<string, number>();

    for (const path of paths) {
      if (path.folder !== CHECK_FOLDER) continue;

      const run = this.checkRun(path.segments);
      if (run == null) continue;

      runs.set(path.owner, Math.max(run, runs.get(path.owner) ?? run));
    }

    return runs;
  }

  // `check/gen_<number>/<file>` — a file placed in the check folder without such a run directory belongs
  // to no run and is therefore superseded by none.
  private static checkRun(segments: string[]): number | undefined {
    const run = CHECK_RUN_PATTERN.exec(segments[1] ?? '')?.[1];

    return run != null ? +run : undefined;
  }

  // The Spider layout has no unique file names: the same name occurs in several folders of one account.
  // A row keeps the plain file name where that is unambiguous within its file type, and is qualified with
  // its parent folder — and, where that still collides, with its full key — where it is not.
  private static resolveNameCollisions(entries: LegacyFileEntry[], paths: LegacyFilePath[]): void {
    const usedNames = new Set<string>();

    entries.forEach((entry, i) => {
      for (const candidate of this.nameCandidates(paths[i])) {
        const usedName = `${entry.type}/${candidate}`;
        if (usedNames.has(usedName)) continue;

        usedNames.add(usedName);
        entry.name = candidate;
        break;
      }
    });
  }

  private static nameCandidates(path: LegacyFilePath): string[] {
    const parent = path.segments[path.segments.length - 2];
    const candidates = [path.name, parent && `${parent}/${path.name}`, path.segments.join('/'), path.key];

    return Array.from(new Set(candidates.filter((c): c is string => Boolean(c))));
  }
}
