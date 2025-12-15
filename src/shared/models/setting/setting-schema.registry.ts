import { Type } from '@nestjs/common';
import { Process } from 'src/shared/services/process.service';
import { CustomSignUpFeesDto } from './dto/custom-sign-up-fees.dto';
import { ManualLogPositionDto } from './dto/manual-log-position.dto';

export type PrimitiveSchema = 'string' | 'number' | 'boolean' | 'string[]';

export interface ArraySchema {
  type: 'array';
  items: Type<any>;
}

export type SettingSchema = PrimitiveSchema | ArraySchema;

export const SettingSchemaRegistry: Record<string, SettingSchema> = {
  // Balance Log Settings
  balanceLogDebtPositions: { type: 'array', items: ManualLogPositionDto },
  balanceLogLiqPositions: { type: 'array', items: ManualLogPositionDto },

  // Finance Log Settings
  minTotalBalanceChf: 'number',
  financeLogUnfilteredTx: 'boolean',

  // Custom Sign Up Fees
  customSignUpFees: { type: 'array', items: CustomSignUpFeesDto },

  // IP Blacklist
  ipBlacklist: 'string[]',
};

export function isArraySchema(schema: SettingSchema): schema is ArraySchema {
  return typeof schema === 'object' && schema.type === 'array';
}

export function isPrimitiveSchema(schema: SettingSchema): schema is PrimitiveSchema {
  return typeof schema === 'string';
}
