// ... existing code ...

// --- mapScryptStatus --- //
export function mapScryptStatus(status: ScryptTransactionStatus): string {
  switch (status) {
    case ScryptTransactionStatus.APPROVED:
      return 'pending';
    case ScryptTransactionStatus.REJECTED:
      return 'rejected';
    default:
      return 'unknown';
  }
}

// ... existing code ...

// --- getWithdrawalStatus --- //
export function getWithdrawalStatus(status: ScryptTransactionStatus): string {
  switch (status) {
    case ScryptTransactionStatus.APPROVED:
      return 'pending';
    case ScryptTransactionStatus.REJECTED:
      return 'rejected';
    default:
      return 'unknown';
  }
}

// ... existing code ...
