import { readFileSync } from 'fs';
import { join } from 'path';
import { getMetadataArgsStorage } from 'typeorm';
import { VirtualIbanIssuanceIntentStatus } from '../virtual-iban-issuance-intent-status.enum';
import { VirtualIbanIssuanceIntent } from '../virtual-iban-issuance-intent.entity';

describe('VirtualIbanIssuanceIntent', () => {
  it('requires an explicit provider and keeps imported-enum columns typed as varchar', () => {
    const columns = getMetadataArgsStorage().columns.filter((column) => column.target === VirtualIbanIssuanceIntent);
    const provider = columns.find((column) => column.propertyName === 'provider');
    const status = columns.find((column) => column.propertyName === 'status');

    expect(provider?.options.nullable).not.toBe(true);
    expect(provider?.options.default).toBeUndefined();
    expect(status?.options.type).toBe('varchar');
    expect(new VirtualIbanIssuanceIntent().provider).toBeUndefined();
    expect(VirtualIbanIssuanceIntentStatus.PENDING).toBe('Pending');
  });

  it('keeps the status enum in the repository-convention *.enum.ts module', () => {
    const entitySource = readFileSync(join(__dirname, '../virtual-iban-issuance-intent.entity.ts'), 'utf8');

    expect(entitySource).not.toContain('export enum VirtualIbanIssuanceIntentStatus');
    expect(entitySource).toContain("from './virtual-iban-issuance-intent-status.enum'");
  });
});
