import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ethers } from 'ethers';
import { Config } from 'src/config/config';
import { EvmBridgeApproval, EvmContractApproval } from 'src/integration/blockchain/shared/evm/dto/evm-approval.dto';
import { EvmCoinTransactionDto } from 'src/integration/blockchain/shared/evm/dto/evm-coin-transaction.dto';
import { EvmRawInputDataDto } from 'src/integration/blockchain/shared/evm/dto/evm-raw-input-data.dto';
import { EvmTokenTransactionDto } from 'src/integration/blockchain/shared/evm/dto/evm-token-transaction.dto';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';
import { EvmRawTransactionDto } from '../../../integration/blockchain/shared/evm/dto/evm-raw-transaction.dto';

@Injectable()
export class GsEvmService {
  constructor(
    private readonly blockchainRegistryService: BlockchainRegistryService,
    private readonly depositService: DepositService,
    private readonly assetService: AssetService,
  ) {}

  async sendRawTransaction({
    request,
    blockchain,
  }: EvmRawTransactionDto): Promise<ethers.providers.TransactionResponse> {
    const client = this.blockchainRegistryService.getEvmClient(blockchain);

    const deposit = await this.depositService.getDepositByAddress(BlockchainAddress.create(request.from, blockchain));

    if (deposit?.accountIndex != null) {
      return client.sendRawTransactionFromAccount(Config.blockchain.evm.walletAccount(deposit.accountIndex), request);
    } else if (request.from === client.walletAddress) {
      return client.sendRawTransactionFromDex(request);
    }

    throw new Error('Provided source address is not known');
  }

  async sendContractTransaction({
    blockchain,
    contractAddress,
    signer,
    callData,
  }: EvmRawInputDataDto): Promise<ethers.providers.TransactionResponse> {
    const client = this.blockchainRegistryService.getEvmClient(blockchain);

    const privateKey = Config.evmWallets.get(signer);
    if (!privateKey) throw new Error(`No private key found for address ${signer}`);

    const { method, types, inputs } = JSON.parse(callData);
    const iface = new ethers.utils.Interface([`function ${method}(${types.join(',')})`]);
    const encodedData = iface.encodeFunctionData(method, inputs);

    const transaction: ethers.providers.TransactionRequest = {
      from: signer,
      to: contractAddress,
      data: encodedData,
      value: 0,
      gasLimit: ethers.BigNumber.from(300000),
    };

    return client.sendRawTransactionFrom(privateKey, transaction);
  }

  async sendTokenTransaction(dto: EvmTokenTransactionDto): Promise<string> {
    const { fromAddress, toAddress, assetId, amount, blockchain } = dto;
    const token = await this.assetService.getAssetById(assetId);

    if (!token) throw new BadRequestException(`Asset ${assetId} not found`);

    const client = this.blockchainRegistryService.getEvmClient(blockchain);

    const deposit = await this.depositService.getDepositByAddress(BlockchainAddress.create(fromAddress, blockchain));

    if (deposit?.accountIndex != null) {
      return client.sendTokenFromAccount(
        Config.blockchain.evm.walletAccount(deposit.accountIndex),
        toAddress,
        token,
        amount,
      );
    } else if (fromAddress === client.walletAddress) {
      return client.sendTokenFromDex(toAddress, token, amount);
    }

    throw new Error('Provided source address is not known');
  }

  async sendCoinTransaction(dto: EvmCoinTransactionDto): Promise<string> {
    const { fromAddress, toAddress, amount, blockchain } = dto;
    const client = this.blockchainRegistryService.getEvmClient(blockchain);

    const deposit = await this.depositService.getDepositByAddress(BlockchainAddress.create(fromAddress, blockchain));

    if (deposit?.accountIndex != null) {
      return client.sendNativeCoinFromAccount(
        Config.blockchain.evm.walletAccount(deposit.accountIndex),
        toAddress,
        amount,
      );
    } else if (fromAddress === client.walletAddress) {
      return client.sendNativeCoinFromDex(toAddress, amount);
    }

    throw new Error('Provided source address is not known');
  }

  async approveBridge({ l1AssetId, l2AssetId }: EvmBridgeApproval): Promise<string> {
    const l1Token = await this.assetService.getAssetById(l1AssetId);
    const l2Token = await this.assetService.getAssetById(l2AssetId);
    if (!l1Token || !l2Token) throw new NotFoundException('Token not found');

    const client = this.blockchainRegistryService.getL2Client(l2Token.blockchain);

    return client.approveBridge(l1Token, l2Token);
  }

  async approveContract({ assetId, contractAddress }: EvmContractApproval): Promise<string> {
    const token = await this.assetService.getAssetById(assetId);
    if (!token) throw new NotFoundException('Token not found');

    const client = this.blockchainRegistryService.getEvmClient(token.blockchain);

    return client.approveContract(token, contractAddress);
  }
}
