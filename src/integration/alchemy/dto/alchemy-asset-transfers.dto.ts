import { AssetTransfersWithMetadataResult } from 'alchemy-sdk';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export interface AlchemyAssetTransfersDto {
  blockchain: Blockchain;
  assetTransfers: AssetTransfersWithMetadataResult[];
}
