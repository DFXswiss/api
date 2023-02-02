import { BadRequestException, Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
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

    const depositPrivateKey = await this.depositService.getDepositKey(
      BlockchainAddress.create(request.from, blockchain),
    );

    if (depositPrivateKey) {
      return await client.sendRawTransactionFromAddress(depositPrivateKey, request);
    } else if (request.from === client.dfxAddress) {
      return await client.sendRawTransactionFromDex(request);
    }

    throw new Error('Provided source address is not known');
  }

  async sendTokenTransaction(dto: EvmTokenTransactionDto): Promise<string> {
    const { fromAddress, toAddress, assetId, amount, feeLimit, blockchain } = dto;
    const token = await this.assetService.getAssetById(assetId);

    if (!token) throw new BadRequestException(`Asset with id ${assetId} not found`);

    const client = this.evmRegistryService.getClient(blockchain);

    const depositPrivateKey = await this.depositService.getDepositKey(
      BlockchainAddress.create(fromAddress, blockchain),
    );

    if (depositPrivateKey) {
      return await client.sendTokenFromAddress(fromAddress, depositPrivateKey, toAddress, token, amount, feeLimit);
    } else if (fromAddress === client.dfxAddress) {
      return await client.sendTokenFromDex(toAddress, token, amount, feeLimit);
    }

    throw new Error('Provided source address is not known');
  }

  async sendCoinTransaction(dto: EvmCoinTransactionDto): Promise<string> {
    const { fromAddress, toAddress, amount, feeLimit, blockchain } = dto;
    const client = this.evmRegistryService.getClient(blockchain);

    const depositPrivateKey = await this.depositService.getDepositKey(
      BlockchainAddress.create(fromAddress, blockchain),
    );

    if (depositPrivateKey) {
      return await client.sendNativeCoinFromAddress(fromAddress, depositPrivateKey, toAddress, amount, feeLimit);
    } else if (fromAddress === client.dfxAddress) {
      return await client.sendNativeCoinFromDex(toAddress, amount, feeLimit);
    }

    throw new Error('Provided source address is not known');
  }
}
