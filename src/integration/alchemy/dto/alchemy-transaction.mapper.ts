import { AssetTransfersWithMetadataResult } from 'alchemy-sdk';
import { AlchemyTransactionDto } from './alchemy-transaction.dto';
import { AlchemyWebhookActivityDto } from './alchemy-webhook.dto';

export class AlchemyTransactionMapper {
  static mapWebhookActivities(webhookActivities: AlchemyWebhookActivityDto[]): AlchemyTransactionDto[] {
    return webhookActivities.map((wa) => AlchemyTransactionMapper.mapWebhookActivity(wa));
  }

  static mapWebhookActivity(webhookActivity: AlchemyWebhookActivityDto): AlchemyTransactionDto {
    return {
      fromAddress: webhookActivity.fromAddress,
      toAddress: webhookActivity.toAddress,
      blockNum: webhookActivity.blockNum,
      hash: webhookActivity.hash,
      rawContract: {
        rawValue: webhookActivity.rawContract.rawValue,
        decimals: webhookActivity.rawContract.decimals,
        address: webhookActivity.rawContract.address,
      },
    };
  }

  static mapAssetTransfers(assetTransfers: AssetTransfersWithMetadataResult[]): AlchemyTransactionDto[] {
    return assetTransfers.map((at) => AlchemyTransactionMapper.mapAssetTransfer(at));
  }

  static mapAssetTransfer(assetTransfer: AssetTransfersWithMetadataResult): AlchemyTransactionDto {
    return {
      fromAddress: assetTransfer.from,
      toAddress: assetTransfer.to,
      blockNum: assetTransfer.blockNum,
      hash: assetTransfer.hash,
      rawContract: {
        rawValue: assetTransfer.rawContract.value,
        decimals: Number(assetTransfer.rawContract.decimal),
        address: assetTransfer.rawContract.address,
      },
    };
  }
}
