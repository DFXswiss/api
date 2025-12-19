// Configuration: Columns to exclude from GS database access per table
// These columns will show the restricted marker for all roles except CADMIN

export const GsRestrictedMarker = '[RESTRICTED]';

export const GsExcludedColumns: Record<string, string[]> = {
  asset: ['ikna'],
};
