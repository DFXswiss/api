import { CardanoUtil } from '../cardano.util';
import {
  CardanoTransactionDto,
  CardanoTransactionResponse,
  CardanoTransactionUtxosResponse,
} from './cardano.dto';

export class CardanoTransactionMapper {
  static async toTransactionDtos(
    transactionResponses: CardanoTransactionResponse[],
    fetchUtxos: (txHash: string) => Promise<CardanoTransactionUtxosResponse>,
  ): Promise<CardanoTransactionDto[]> {
    const transactions = await Promise.all(
      transactionResponses.map((tr) => CardanoTransactionMapper.toTransactionDto(tr, fetchUtxos)),
    );
    return transactions.filter((t) => t);
  }

  static async toTransactionDto(
    transactionResponse: CardanoTransactionResponse,
    fetchUtxos: (txHash: string) => Promise<CardanoTransactionUtxosResponse>,
  ): Promise<CardanoTransactionDto | undefined> {
    if (!transactionResponse) return undefined;

    // Fetch UTXO data to get addresses and amounts
    const utxos = await fetchUtxos(transactionResponse.hash);

    // Extract unique sender addresses from inputs (exclude collateral and reference inputs)
    const fromAddresses = [
      ...new Set(utxos.inputs.filter((input) => !input.collateral && !input.reference).map((input) => input.address)),
    ];

    // Extract unique receiver addresses from outputs (exclude collateral and reference outputs)
    const toAddresses = [
      ...new Set(utxos.outputs.filter((output) => !output.collateral).map((output) => output.address)),
    ];

    // Calculate total ADA amount from outputs (lovelace units only)
    const totalLovelaceAmount = utxos.outputs
      .filter((output) => !output.collateral)
      .reduce((sum, output) => {
        const lovelaceAmount = output.amount.find((a) => a.unit === 'lovelace');
        return sum + BigInt(lovelaceAmount?.quantity ?? '0');
      }, BigInt(0));

    return {
      status: transactionResponse.valid_contract ? 'SUCCESS' : 'FAILED',
      blockNumber: transactionResponse.block,
      timestamp: transactionResponse.block_time,
      txId: transactionResponse.hash,
      fee: CardanoUtil.fromLovelaceAmount(transactionResponse.fees),
      from: fromAddresses.join(','), // Multiple senders joined by comma
      to: toAddresses.join(','), // Multiple receivers joined by comma
      amount: CardanoUtil.fromLovelaceAmount(totalLovelaceAmount.toString()),
    };
  }
}
