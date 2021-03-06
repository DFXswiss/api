import { createDefaultBuy } from 'src/payment/models/buy/__tests__/mock/buy.entity.mock';
import { AmlCheck } from '../../../enums/aml-check.enum';
import { BuyCrypto } from '../../buy-crypto.entity';
import { createCustomBuyCryptoBatch } from './buy-crypto-batch.entity.mock';

export function createDefaultBuyCrypto(): BuyCrypto {
  return createCustomBuyCrypto({});
}

export function createCustomBuyCrypto(customValues: Partial<BuyCrypto>): BuyCrypto {
  const {
    buy,
    batch,
    inputAmount,
    inputAsset,
    inputReferenceAmount,
    inputReferenceAsset,
    amountInChf,
    amountInEur,
    amlCheck,
    percentFee,
    percentFeeAmount,
    absoluteFeeAmount,
    inputReferenceAmountMinusFee,
    outputReferenceAmount,
    outputReferenceAsset,
    outputAmount,
    outputAsset,
    txId,
    outputDate,
    recipientMail,
    mailSendDate,
    usedRef,
    refProvision,
    refFactor,
  } = customValues;

  const keys = Object.keys(customValues);
  const entity = new BuyCrypto();

  entity.buy = keys.includes('buy') ? buy : createDefaultBuy();
  entity.batch = keys.includes('batch') ? batch : createCustomBuyCryptoBatch({ transactions: [entity] });
  entity.inputAmount = keys.includes('inputAmount') ? inputAmount : 100;
  entity.inputAsset = keys.includes('inputAsset') ? inputAsset : 'EUR';
  entity.inputReferenceAmount = keys.includes('inputReferenceAmount') ? inputReferenceAmount : 100;
  entity.inputReferenceAsset = keys.includes('inputReferenceAsset') ? inputReferenceAsset : 'EUR';
  entity.amountInChf = keys.includes('amountInChf') ? amountInChf : 120;
  entity.amountInEur = keys.includes('amountInEur') ? amountInEur : 100;
  entity.amlCheck = keys.includes('amlCheck') ? amlCheck : AmlCheck.PASS;
  entity.percentFee = keys.includes('percentFee') ? percentFee : 0.01;
  entity.percentFeeAmount = keys.includes('percentFeeAmount') ? percentFeeAmount : 1;
  entity.absoluteFeeAmount = keys.includes('absoluteFeeAmount') ? absoluteFeeAmount : null;
  entity.inputReferenceAmountMinusFee = keys.includes('inputReferenceAmountMinusFee')
    ? inputReferenceAmountMinusFee
    : 99;
  entity.outputReferenceAmount = keys.includes('outputReferenceAmount') ? outputReferenceAmount : 0.005;
  entity.outputReferenceAsset = keys.includes('outputReferenceAsset') ? outputReferenceAsset : 'BTC';
  entity.outputAmount = keys.includes('outputAmount') ? outputAmount : 0.2;
  entity.outputAsset = keys.includes('outputAsset') ? outputAsset : 'dTSLA';
  entity.txId = keys.includes('txId') ? txId : 'TX_ID_01';
  entity.outputDate = keys.includes('outputDate') ? outputDate : new Date();
  entity.recipientMail = keys.includes('recipientMail') ? recipientMail : '';
  entity.mailSendDate = keys.includes('mailSendDate') ? mailSendDate : Date.now();
  entity.usedRef = keys.includes('usedRef') ? usedRef : '';
  entity.refProvision = keys.includes('refProvision') ? refProvision : 0;
  entity.refFactor = keys.includes('refFactor') ? refFactor : 0;

  return entity;
}
