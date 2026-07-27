import { readFileSync } from 'fs';
import { join } from 'path';
import { VibanAccountHolder } from '../providers/viban-account-holder.enum';

describe('virtual IBAN review conformity', () => {
  it('keeps account-holder enum values in PascalCase in their dedicated file', () => {
    expect(VibanAccountHolder).toEqual({
      CUSTOMER: 'Customer',
      DFX: 'Dfx',
    });

    const providerInterface = readFileSync(join(__dirname, '../providers/viban-provider.interface.ts'), 'utf8');
    expect(providerInterface).not.toMatch(/export enum VibanAccountHolder/);
  });

  it('uses absolute entity imports in the issuance-event entity', () => {
    const entity = readFileSync(join(__dirname, '../virtual-iban-issuance-event.entity.ts'), 'utf8');

    expect(entity).toContain("from 'src/shared/models/entity'");
    expect(entity).toContain("from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban-issuance-intent.entity'");
    expect(entity).not.toMatch(/from ['"]\.\.?\//);
  });

  it('requires callers to supply every Frick listing pagination argument', () => {
    const service = readFileSync(join(__dirname, '../../../../../integration/bank/services/frick.service.ts'), 'utf8');

    expect(service).toMatch(
      /async listVibans\(\s*referenceAccountIban: string \| undefined,\s*states: FrickVirtualIbanState\[\] \| undefined,\s*pageIndex: number,\s*pageSize: number,/s,
    );
    expect(service).toMatch(
      /async listAllVibans\(\s*referenceAccountIban: string \| undefined,\s*states: FrickVirtualIbanState\[\] \| undefined,\s*pageSize: number,/s,
    );
  });
});
