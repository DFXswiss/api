import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { Deposit } from 'src/subdomains/supporting/address-pool/deposit/deposit.entity';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';
import { PayoutGroup } from 'src/subdomains/supporting/payout/services/base/payout-bitcoin-based.service';
import { Blockchain } from '../../shared/enums/blockchain.enum';
import { BlockchainService } from '../../shared/util/blockchain.service';
import { ZanoSendTransferResultDto, ZanoTransactionDto, ZanoTransferDto } from '../dto/zano.dto';
import { ZanoClient } from '../zano-client';

@Injectable()
export class ZanoService extends BlockchainService implements OnModuleInit {
  private readonly client: ZanoClient;

  private depositService: DepositService;

  constructor(private readonly moduleRef: ModuleRef, private readonly http: HttpService) {
    super();

    this.client = new ZanoClient(this.http);
  }

  onModuleInit() {
    this.depositService = this.moduleRef.get(DepositService, { strict: false });
  }

  getDefaultClient(): ZanoClient {
    return this.client;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const status = await this.client.getInfo();
      if (!status) return false;
      if ('OK' !== status) return false;

      return true;
    } catch {
      return false;
    }
  }

  async getBlockHeight(): Promise<number> {
    return this.client.getBlockHeight();
  }

  async verifySignature(message: string, address: string, signature: string): Promise<boolean> {
    return this.client.verifySignature(message, address, signature);
  }

  async getCoinBalance(): Promise<number> {
    return this.client.getNativeCoinBalance();
  }

  async getUnlockedBalance(): Promise<number> {
    return this.client.getUnlockedBalance();
  }

  getFeeEstimate(): number {
    return this.client.getFeeEstimate();
  }

  async isTxComplete(txId: string, confirmations = 0): Promise<boolean> {
    return this.client.isTxComplete(txId, confirmations);
  }

  async getTransaction(txId: string): Promise<ZanoTransactionDto | undefined> {
    return this.client.getTransaction(txId);
  }

  async getTransactionHistory(blockHeight: number): Promise<ZanoTransferDto[]> {
    return this.client.getTransactionHistory(blockHeight);
  }

  async sendTransfer(destinationAddress: string, amount: number): Promise<ZanoSendTransferResultDto> {
    return this.client.sendTransfer(destinationAddress, amount);
  }

  async sendTransfers(payout: PayoutGroup): Promise<ZanoSendTransferResultDto> {
    return this.client.sendTransfers(payout);
  }

  async getDepositByBlockchainAndIndex(blockchain: Blockchain, index: number): Promise<Deposit> {
    return this.depositService.getDepositByBlockchainAndIndex(blockchain, index);
  }

  getPaymentRequest(address: string, amount: number): string {
    return `zano:${address}?amount=${Util.numberToFixedString(amount)}`;
  }
}
