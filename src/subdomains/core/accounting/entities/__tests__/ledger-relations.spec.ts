import { getMetadataArgsStorage } from 'typeorm';
import { RelationMetadataArgs } from 'typeorm/metadata-args/RelationMetadataArgs';
import { RelationIdMetadataArgs } from 'typeorm/metadata-args/RelationIdMetadataArgs';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { createCustomLedgerLeg } from '../__mocks__/ledger-leg.entity.mock';
import { createCustomLedgerTx } from '../__mocks__/ledger-tx.entity.mock';
import { LedgerAccount } from '../ledger-account.entity';
import { LedgerLeg } from '../ledger-leg.entity';
import { LedgerTx } from '../ledger-tx.entity';

// TypeORM keeps the relation/relationId lambdas (type thunks, inverse-side selectors, relationId selectors) in the
// global metadata-args storage. Invoking them executes the exact arrow expressions on the entity definitions and
// asserts that each relation targets the right entity and inverse property — a wrong inverse side or a relationId
// pointed at the wrong relation would make these red.
const storage = getMetadataArgsStorage();

function relation(target: Function, propertyName: string): RelationMetadataArgs {
  const found = storage.relations.find((r) => r.target === target && r.propertyName === propertyName);
  if (!found) throw new Error(`relation ${target.name}.${propertyName} not found`);
  return found;
}

function relationId(target: Function, propertyName: string): RelationIdMetadataArgs {
  const found = storage.relationIds.find((r) => r.target === target && r.propertyName === propertyName);
  if (!found) throw new Error(`relationId ${target.name}.${propertyName} not found`);
  return found;
}

describe('ledger entity relations', () => {
  describe('LedgerLeg', () => {
    it('joins tx → LedgerTx with the legs inverse side', () => {
      const rel = relation(LedgerLeg, 'tx');
      expect((rel.type as () => unknown)()).toBe(LedgerTx);

      const tx = createCustomLedgerTx({ id: 99 });
      // inverse-side selector returns tx.legs
      const inverse = (rel.inverseSideProperty as (t: LedgerTx) => unknown)(tx);
      expect(inverse).toBe(tx.legs);
    });

    it('exposes txId as the relationId of tx', () => {
      const rel = relationId(LedgerLeg, 'txId');
      const tx = createCustomLedgerTx({ id: 7 });
      const leg = createCustomLedgerLeg({ tx });
      expect((rel.relation as (l: LedgerLeg) => unknown)(leg)).toBe(tx);
    });

    it('joins account → LedgerAccount', () => {
      const rel = relation(LedgerLeg, 'account');
      expect((rel.type as () => unknown)()).toBe(LedgerAccount);
    });

    it('exposes accountId as the relationId of account', () => {
      const rel = relationId(LedgerLeg, 'accountId');
      const account = Object.assign(new LedgerAccount(), { id: 5 });
      const leg = createCustomLedgerLeg({ account });
      expect((rel.relation as (l: LedgerLeg) => unknown)(leg)).toBe(account);
    });
  });

  describe('LedgerTx', () => {
    it('self-references reversalOf → LedgerTx', () => {
      const rel = relation(LedgerTx, 'reversalOf');
      expect((rel.type as () => unknown)()).toBe(LedgerTx);
    });

    it('exposes reversalOfId as the relationId of reversalOf', () => {
      const rel = relationId(LedgerTx, 'reversalOfId');
      const original = createCustomLedgerTx({ id: 1 });
      const correction = createCustomLedgerTx({ id: 2, reversalOf: original });
      expect((rel.relation as (t: LedgerTx) => unknown)(correction)).toBe(original);
    });

    it('owns legs → LedgerLeg with the tx inverse side', () => {
      const rel = relation(LedgerTx, 'legs');
      expect((rel.type as () => unknown)()).toBe(LedgerLeg);

      const leg = createCustomLedgerLeg({ id: 3 });
      const inverse = (rel.inverseSideProperty as (l: LedgerLeg) => unknown)(leg);
      expect(inverse).toBe(leg.tx);
    });
  });

  describe('LedgerAccount', () => {
    it('joins asset → Asset', () => {
      const rel = relation(LedgerAccount, 'asset');
      expect((rel.type as () => unknown)()).toBe(Asset);
    });

    it('exposes assetId as the relationId of asset', () => {
      const rel = relationId(LedgerAccount, 'assetId');
      const asset = Object.assign(new Asset(), { id: 42 });
      const account = Object.assign(new LedgerAccount(), { id: 5, asset });
      expect((rel.relation as (a: LedgerAccount) => unknown)(account)).toBe(asset);
    });
  });
});
