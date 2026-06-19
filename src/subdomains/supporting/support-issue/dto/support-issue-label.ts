import { SupportIssueReason, SupportIssueType } from '../enums/support-issue.enum';

// German display labels for support issue types/reasons, mirroring the labels shown in the
// services frontend. Used for human-facing German messages such as Telegram escalation alerts.
export const SupportIssueTypeLabelDe: Record<SupportIssueType, string> = {
  [SupportIssueType.GENERIC_ISSUE]: 'Allgemeine Anfrage',
  [SupportIssueType.TRANSACTION_ISSUE]: 'Transaktionsbezogene Anfrage',
  [SupportIssueType.VERIFICATION_CALL]: 'Verifizierungsanruf',
  [SupportIssueType.KYC_ISSUE]: 'KYC-Anfrage',
  [SupportIssueType.LIMIT_REQUEST]: 'Antrag auf Limit-Erhöhung',
  [SupportIssueType.PARTNERSHIP_REQUEST]: 'Anfrage zu einer Partnerschaft',
  [SupportIssueType.NOTIFICATION_OF_CHANGES]: 'Mitteilung von Änderungen',
  [SupportIssueType.BUG_REPORT]: 'Fehlermeldung',
};

export const SupportIssueReasonLabelDe: Record<SupportIssueReason, string> = {
  [SupportIssueReason.OTHER]: 'Andere',
  [SupportIssueReason.DATA_REQUEST]: 'Datenanfrage',
  [SupportIssueReason.FUNDS_NOT_RECEIVED]: 'Zahlung nicht erhalten',
  [SupportIssueReason.TRANSACTION_MISSING]: 'Transaktion fehlt',
  [SupportIssueReason.REJECT_CALL]: 'Anruf ablehnen',
  [SupportIssueReason.REPEAT_CALL]: 'Anruf wiederholen',
  [SupportIssueReason.NAME_CHANGED]: 'Name geändert',
  [SupportIssueReason.ADDRESS_CHANGED]: 'Adresse geändert',
  [SupportIssueReason.CIVIL_STATUS_CHANGED]: 'Zivilstand geändert',
};
