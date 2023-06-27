import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ethers } from 'ethers';
import { Config } from 'src/config/config';
import { EvmTokenApproval, EvmTokenBridgeApproval } from 'src/integration/blockchain/shared/evm/dto/approval.dto';
import { EvmCoinTransactionDto } from 'src/integration/blockchain/shared/evm/dto/evm-coin-transaction.dto';
import { EvmTokenTransactionDto } from 'src/integration/blockchain/shared/evm/dto/evm-token-transaction.dto';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';
import { EvmRawTransactionDto } from '../../../integration/blockchain/shared/evm/dto/evm-raw-transaction.dto';

@Injectable()
export class GsEvmService {
  constructor(
    private readonly evmRegistryService: EvmRegistryService,
    private readonly depositService: DepositService,
    private readonly assetService: AssetService,
  ) {}

  async sendRawTransaction({
    request,
    blockchain,
  }: EvmRawTransactionDto): Promise<ethers.providers.TransactionResponse> {
    const client = this.evmRegistryService.getClient(blockchain);

    const deposit = await this.depositService.getDepositByAddress(BlockchainAddress.create(request.from, blockchain));

    if (deposit?.accountIndex != null) {
      return client.sendRawTransactionFromAccount(Config.blockchain.evm.walletAccount(deposit.accountIndex), request);
    } else if (request.from === client.dfxAddress) {
      return client.sendRawTransactionFromDex(request);
    }

    throw new Error('Provided source address is not known');
  }

  async sendTokenTransaction(dto: EvmTokenTransactionDto): Promise<string> {
    const { fromAddress, toAddress, assetId, amount, feeLimit, blockchain } = dto;
    const token = await this.assetService.getAssetById(assetId);

    if (!token) throw new BadRequestException(`Asset ${assetId} not found`);

    const client = this.evmRegistryService.getClient(blockchain);

    const deposit = await this.depositService.getDepositByAddress(BlockchainAddress.create(fromAddress, blockchain));

    if (deposit?.accountIndex != null) {
      return client.sendTokenFromAccount(
        Config.blockchain.evm.walletAccount(deposit.accountIndex),
        toAddress,
        token,
        amount,
        feeLimit,
      );
    } else if (fromAddress === client.dfxAddress) {
      return client.sendTokenFromDex(toAddress, token, amount, feeLimit);
    }

    throw new Error('Provided source address is not known');
  }

  async sendCoinTransaction(dto: EvmCoinTransactionDto): Promise<string> {
    const { fromAddress, toAddress, amount, feeLimit, blockchain } = dto;
    const client = this.evmRegistryService.getClient(blockchain);

    const deposit = await this.depositService.getDepositByAddress(BlockchainAddress.create(fromAddress, blockchain));

    if (deposit?.accountIndex != null) {
      return client.sendNativeCoinFromAccount(
        Config.blockchain.evm.walletAccount(deposit.accountIndex),
        toAddress,
        amount,
        feeLimit,
      );
    } else if (fromAddress === client.dfxAddress) {
      return client.sendNativeCoinFromDex(toAddress, amount, feeLimit);
    }

    throw new Error('Provided source address is not known');
  }

  async approveToken({ assetId, contractAddress }: EvmTokenApproval): Promise<string> {
    const token = await this.assetService.getAssetById(assetId);
    if (!token) throw new NotFoundException('Token not found');

    const client = this.evmRegistryService.getClient(token.blockchain);

    return client.approveToken(token, contractAddress);
  }

  async approveTokenBridge({ l1AssetId, l2AssetId }: EvmTokenBridgeApproval): Promise<string> {
    const l1Token = await this.assetService.getAssetById(l1AssetId);
    const l2Token = await this.assetService.getAssetById(l2AssetId);
    if (!l1Token || !l2Token) throw new NotFoundException('Token not found');

    const client = this.evmRegistryService.getL2Client(l2Token.blockchain);

    return client.approveTokenBridge(l1Token, l2Token);
  }
}
