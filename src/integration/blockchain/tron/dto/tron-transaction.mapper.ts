import { Util } from 'src/shared/utils/util';
import { TronUtil } from '../tron.util';
import { TronTransactionContractResponse, TronTransactionDto, TronTransactionResponse } from './tron.dto';

export class TronTransactionMapper {
  static toTransactionDtos(transactionReponses: TronTransactionResponse[]): TronTransactionDto[] {
    return transactionReponses.map((tr) => TronTransactionMapper.toTransactionDto(tr)).filter((t) => t);
  }

  static toTransactionDto(transactionReponse: TronTransactionResponse): TronTransactionDto | undefined {
    const contract = transactionReponse.rawData.contract[0];

    if (Util.equalsIgnoreCase(contract.type, 'TransferContract'))
      return TronTransactionMapper.convertCoinTransaction(transactionReponse, contract);

    if (Util.equalsIgnoreCase(contract.type, 'TriggerSmartContract'))
      return TronTransactionMapper.convertTokenTransaction(transactionReponse, contract);
  }

  private static convertCoinTransaction(
    transactionReponse: TronTransactionResponse,
    contract: TronTransactionContractResponse,
  ): TronTransactionDto {
    return {
      ...TronTransactionMapper.createTransaction(transactionReponse),
      from: contract.parameter.value.ownerAddressBase58,
      to: contract.parameter.value.toAddressBase58,
      amount: TronUtil.fromSunAmount(contract.parameter.value.amount),
    };
  }

  private static convertTokenTransaction(
    transactionReponse: TronTransactionResponse,
    contract: TronTransactionContractResponse,
  ): TronTransactionDto | undefined {
    const data = contract.parameter.value.data;

    // a9059cbb: transfer
    const methodId = data.slice(0, 8);
    if (methodId !== 'a9059cbb') return;

    return {
      ...TronTransactionMapper.createTransaction(transactionReponse),
      from: contract.parameter.value.ownerAddressBase58,
      to: TronTransactionMapper.getToFromData(data),
      amount: TronTransactionMapper.getAmountFromData(data),
      tokenAddress: contract.parameter.value.contractAddressBase58,
    };
  }

  private static createTransaction(transactionReponse: TronTransactionResponse): TronTransactionDto {
    const fee = transactionReponse.fee ?? Util.sum(transactionReponse.ret.map((r) => r.fee ?? 0));

    return {
      status: transactionReponse.ret.map((r) => r.contractRet).join(','),
      blockNumber: transactionReponse.blockNumber,
      timestamp: transactionReponse.rawData.timestamp,
      txId: transactionReponse.txID,
      fee: TronUtil.fromSunAmount(fee),
      from: undefined,
      to: undefined,
      amount: undefined,
    };
  }

  private static getToFromData(data: string): string {
    const params = data.slice(8);
    const receiverAddress = params.slice(24, 64);
    return TronUtil.convertToTronAddress(receiverAddress);
  }

  private static getAmountFromData(data: string): number {
    const params = data.slice(8);
    const amount = params.slice(64);
    return TronUtil.fromSunAmount('0x' + amount);
  }
}
