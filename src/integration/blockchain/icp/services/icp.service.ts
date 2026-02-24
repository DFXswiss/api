import { Principal } from '@dfinity/principal';
import { Injectable } from '@nestjs/common';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import nacl from 'tweetnacl';
import { WalletAccount } from '../../shared/evm/domain/wallet-account';
import { SignatureException } from '../../shared/exceptions/signature.exception';
import { BlockchainService } from '../../shared/util/blockchain.service';
import { IcpTransferQueryResult } from '../dto/icp.dto';
import { InternetComputerClient } from '../icp-client';

@Injectable()
export class InternetComputerService extends BlockchainService {
  private readonly client: InternetComputerClient;

  constructor() {
    super();

    this.client = new InternetComputerClient();
  }

  getDefaultClient(): InternetComputerClient {
    return this.client;
  }

  getWalletAddress(): string {
    return this.client.walletAddress;
  }

  getPaymentRequest(address: string, amount: number): string {
    return `internetComputer:${address}?amount=${Util.numberToFixedString(amount)}`;
  }

  async verifySignature(message: string, address: string, signature: string, key?: string): Promise<boolean> {
    if (!key) throw new SignatureException('Public key is required for ICP signature verification');

    const publicKeyBytes = Buffer.from(key, 'hex');

    if (publicKeyBytes.length === 32) {
      return this.verifyEd25519(message, address, publicKeyBytes, signature);
    }

    if (publicKeyBytes.length === 33 || publicKeyBytes.length === 65) {
      return this.verifySecp256k1(message, address, publicKeyBytes, signature);
    }

    throw new SignatureException(`Unsupported ICP public key length: ${publicKeyBytes.length}`);
  }

  private verifyEd25519(message: string, address: string, publicKeyBytes: Buffer, signature: string): boolean {
    try {
      const derivedPrefix = Buffer.from('302a300506032b6570032100', 'hex');
      const derivedKey = new Uint8Array([...derivedPrefix, ...publicKeyBytes]);

      const derivedPrincipal = Principal.selfAuthenticating(derivedKey);
      if (derivedPrincipal.toText() !== address) return false;

      const messageBytes = Util.stringToUint8(message, 'utf8');
      const signatureBytes = Buffer.from(signature, 'hex');

      return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    } catch {
      return false;
    }
  }

  private verifySecp256k1(message: string, address: string, publicKeyBytes: Buffer, signature: string): boolean {
    try {
      const derivedPrefix =
        publicKeyBytes.length === 33
          ? Buffer.from('3036301006072a8648ce3d020106052b8104000a032200', 'hex')
          : Buffer.from('3056301006072a8648ce3d020106052b8104000a034200', 'hex');
      const derivedKey = new Uint8Array([...derivedPrefix, ...publicKeyBytes]);

      const derivedPrincipal = Principal.selfAuthenticating(derivedKey);
      if (derivedPrincipal.toText() !== address) return false;

      const messageBytes = Util.stringToUint8(message, 'utf8');
      const messageHash = sha256(messageBytes);
      const signatureBytes = Buffer.from(signature, 'hex');

      return secp256k1.verify(signatureBytes, messageHash, publicKeyBytes, { lowS: false });
    } catch {
      return false;
    }
  }

  async getBlockHeight(): Promise<number> {
    return this.client.getBlockHeight();
  }

  async getTransfers(start: number, count: number): Promise<IcpTransferQueryResult> {
    return this.client.getTransfers(start, count);
  }

  async getIcrcBlockHeight(canisterId: string): Promise<number> {
    return this.client.getIcrcBlockHeight(canisterId);
  }

  async getIcrcTransfers(
    canisterId: string,
    decimals: number,
    start: number,
    count: number,
  ): Promise<IcpTransferQueryResult> {
    return this.client.getIcrcTransfers(canisterId, decimals, start, count);
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.client.getNativeCoinBalance();
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    return this.client.getNativeCoinBalanceForAddress(address);
  }

  async getTokenBalance(asset: Asset, address?: string): Promise<number> {
    return this.client.getTokenBalance(asset, address ?? this.client.walletAddress);
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    return this.client.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasCostForTokenTransaction(token?: Asset): Promise<number> {
    return this.client.getCurrentGasCostForTokenTransaction(token);
  }

  async sendNativeCoinFromDex(toAddress: string, amount: number): Promise<string> {
    return this.client.sendNativeCoinFromDex(toAddress, amount);
  }

  async sendNativeCoinFromDepositWallet(accountIndex: number, toAddress: string, amount: number): Promise<string> {
    return this.client.sendNativeCoinFromDepositWallet(accountIndex, toAddress, amount);
  }

  async sendTokenFromDex(toAddress: string, token: Asset, amount: number): Promise<string> {
    return this.client.sendTokenFromDex(toAddress, token, amount);
  }

  async sendTokenFromDepositWallet(
    accountIndex: number,
    toAddress: string,
    token: Asset,
    amount: number,
  ): Promise<string> {
    return this.client.sendTokenFromDepositWallet(accountIndex, toAddress, token, amount);
  }

  async checkAllowance(
    ownerPrincipal: string,
    spenderPrincipal: string,
    canisterId: string,
    decimals: number,
  ): Promise<{ allowance: number; expiresAt?: number }> {
    return this.client.checkAllowance(ownerPrincipal, spenderPrincipal, canisterId, decimals);
  }

  async transferFromWithAccount(
    account: WalletAccount,
    ownerPrincipal: string,
    toAddress: string,
    amount: number,
    canisterId: string,
    decimals: number,
  ): Promise<string> {
    return this.client.transferFromWithAccount(account, ownerPrincipal, toAddress, amount, canisterId, decimals);
  }

  async isTxComplete(blockIndex: string): Promise<boolean> {
    return this.client.isTxComplete(blockIndex);
  }

  async getTxActualFee(blockIndex: string): Promise<number> {
    return this.client.getTxActualFee(blockIndex);
  }
}
