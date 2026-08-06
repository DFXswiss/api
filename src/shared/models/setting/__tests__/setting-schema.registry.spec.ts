import { RefBonusAgreementDto } from '../dto/ref-bonus-agreement.dto';
import {
  ArraySchema,
  isArraySchema,
  isPrimitiveSchema,
  SettingSchemaRegistry,
} from '../setting-schema.registry';

describe('SettingSchemaRegistry', () => {
  describe('isArraySchema', () => {
    it('should return true for an array schema', () => {
      expect(isArraySchema(SettingSchemaRegistry.refBonusAgreements)).toBe(true);
    });

    it('should return false for a primitive schema', () => {
      expect(isArraySchema(SettingSchemaRegistry.minTotalBalanceChf)).toBe(false);
    });
  });

  describe('isPrimitiveSchema', () => {
    it('should return true for a primitive schema', () => {
      expect(isPrimitiveSchema(SettingSchemaRegistry.financeLogUnfilteredTx)).toBe(true);
    });

    it('should return false for an array schema', () => {
      expect(isPrimitiveSchema(SettingSchemaRegistry.refBonusAgreements)).toBe(false);
    });
  });

  describe('refBonusAgreements entry', () => {
    it('should be defined as an array schema with RefBonusAgreementDto items', () => {
      expect(SettingSchemaRegistry.refBonusAgreements).toBeDefined();
      expect(isArraySchema(SettingSchemaRegistry.refBonusAgreements)).toBe(true);
      expect((SettingSchemaRegistry.refBonusAgreements as ArraySchema).items).toBe(RefBonusAgreementDto);
    });
  });

  describe('primitive entry', () => {
    it('should have minTotalBalanceChf as number and isPrimitiveSchema true', () => {
      expect(SettingSchemaRegistry.minTotalBalanceChf).toBe('number');
      expect(isPrimitiveSchema(SettingSchemaRegistry.minTotalBalanceChf)).toBe(true);
    });
  });
});
