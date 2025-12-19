import { Util } from 'src/shared/utils/util';
import { CardanoUtil } from '../cardano.util';
import { CardanoTransactionDto, CardanoTransactionResponse } from './cardano.dto';

export class CardanoTransactionMapper {
  static toTransactionDtos(
    transactionResponses: CardanoTransactionResponse[],
    address: string,
  ): CardanoTransactionDto[] {
    return transactionResponses.map((tr) => CardanoTransactionMapper.toTransactionDto(tr, address));
  }

  static toTransactionDto(transactionResponse: CardanoTransactionResponse, address: string): CardanoTransactionDto {
    console.log(JSON.stringify(transactionResponse));
    console.log('-'.repeat(80));

    const fromAddresses = [...new Set(transactionResponse.inputs.map((input) => input.address))];
    const toAddresses = [...new Set(transactionResponse.outputs.map((output) => output.address))];
    const totalAmount = transactionResponse.outputs.reduce((sum, output) => {
      return Util.equalsIgnoreCase(address, output.address) ? sum + BigInt(output.value ?? '0') : sum;
    }, BigInt(0));

    return {
      blockNumber: transactionResponse.block.number,
      blocktimeMillis: transactionResponse.block.blocktimeMillis,
      txId: transactionResponse.hash,
      fee: CardanoUtil.fromLovelaceAmount(transactionResponse.fee),
      from: fromAddresses.join(','),
      to: toAddresses.join(','),
      amount: CardanoUtil.fromLovelaceAmount(totalAmount.toString()),
    };
  }
}
