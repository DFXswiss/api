import { BadRequestException, Injectable } from '@nestjs/common';
import * as SolanaToken from '@solana/spl-token';
import * as Solana from '@solana/web3.js';
import { TronWeb } from 'tronweb';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SolanaClient } from 'src/integration/blockchain/solana/solana-client';
import { SolanaService } from 'src/integration/blockchain/solana/services/solana.service';
import { SolanaUtil } from 'src/integration/blockchain/solana/solana.util';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { HttpService } from 'src/shared/services/http.service';
import {
  BroadcastResultDto,
  BroadcastTransactionDto,
  CreateTransactionDto,
  UnsignedTransactionDto,
} from '../dto/create-transaction.dto';

@Injectable()
export class BlockchainTransactionService {
  private readonly solanaClient: SolanaClient;

  constructor(
    private readonly solanaService: SolanaService,
    private readonly assetService: AssetService,
    private readonly http: HttpService,
  ) {
    this.solanaClient = this.solanaService.getDefaultClient();
  }

  async createTransaction(dto: CreateTransactionDto): Promise<UnsignedTransactionDto> {
    const { blockchain, fromAddress, toAddress, amount, assetId } = dto;

    const asset = assetId ? await this.assetService.getAssetById(assetId) : null;

    if (blockchain === Blockchain.SOLANA) {
      return this.createSolanaTransaction(fromAddress, toAddress, amount, asset);
    }

    if (blockchain === Blockchain.TRON) {
      return this.createTronTransaction(fromAddress, toAddress, amount, asset);
    }

    throw new BadRequestException(`Blockchain ${blockchain} is not supported for transaction creation`);
  }

  async broadcastTransaction(dto: BroadcastTransactionDto): Promise<BroadcastResultDto> {
    const { blockchain, signedTransaction } = dto;

    if (blockchain === Blockchain.SOLANA) {
      return this.broadcastSolanaTransaction(signedTransaction);
    }

    if (blockchain === Blockchain.TRON) {
      return this.broadcastTronTransaction(signedTransaction);
    }

    throw new BadRequestException(`Blockchain ${blockchain} is not supported for broadcasting`);
  }

  // --- SOLANA --- //

  private async createSolanaTransaction(
    fromAddress: string,
    toAddress: string,
    amount: number,
    asset: Asset | null,
  ): Promise<UnsignedTransactionDto> {
    const fromPublicKey = new Solana.PublicKey(fromAddress);
    const toPublicKey = new Solana.PublicKey(toAddress);

    const transaction = new Solana.Transaction();

    if (!asset || asset.type === AssetType.COIN) {
      // Native SOL transfer
      const lamports = SolanaUtil.toLamportAmount(amount);
      transaction.add(
        Solana.SystemProgram.transfer({
          fromPubkey: fromPublicKey,
          toPubkey: toPublicKey,
          lamports,
        }),
      );
    } else {
      // Token transfer
      const mintAddress = asset.chainId;
      if (!mintAddress) throw new BadRequestException(`No mint address for token ${asset.uniqueName}`);
      const decimals = asset.decimals;
      if (!decimals) throw new BadRequestException(`No decimals for token ${asset.uniqueName}`);

      const mintPublicKey = new Solana.PublicKey(mintAddress);
      const fromTokenAccount = await SolanaToken.getAssociatedTokenAddress(mintPublicKey, fromPublicKey);
      const toTokenAccount = await SolanaToken.getAssociatedTokenAddress(mintPublicKey, toPublicKey);

      const isTokenAccountAvailable = await this.solanaClient.checkTokenAccount(toAddress, mintAddress);

      if (!isTokenAccountAvailable) {
        transaction.add(
          SolanaToken.createAssociatedTokenAccountInstruction(
            fromPublicKey,
            toTokenAccount,
            toPublicKey,
            mintPublicKey,
          ),
        );
      }

      transaction.add(
        SolanaToken.createTransferInstruction(
          fromTokenAccount,
          toTokenAccount,
          fromPublicKey,
          SolanaUtil.toLamportAmount(amount, decimals),
          [],
          SolanaToken.TOKEN_PROGRAM_ID,
        ),
      );
    }

    // Add priority fee
    const priorityRate = Config.blockchain.solana.transactionPriorityRate * 100;
    transaction.add(Solana.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityRate }));

    // Set fee payer and recent blockhash
    transaction.feePayer = fromPublicKey;
    const connection = this.getSolanaConnection();
    const latestBlockHash = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = latestBlockHash.blockhash;

    // Serialize without signatures (for external wallet signing)
    const serializedTransaction = transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');

    return {
      rawTransaction: serializedTransaction,
      encoding: 'base64',
      recentBlockhash: latestBlockHash.blockhash,
    };
  }

  private async broadcastSolanaTransaction(signedTransaction: string): Promise<BroadcastResultDto> {
    // signedTransaction is base64-encoded from the frontend
    const connection = this.getSolanaConnection();

    try {
      const txBuffer = Buffer.from(signedTransaction, 'base64');
      const txHash = await connection.sendRawTransaction(txBuffer, {
        skipPreflight: true,
        preflightCommitment: 'processed',
      });

      return { txHash };
    } catch (error) {
      throw new BadRequestException(`Failed to broadcast Solana transaction: ${(error as Error).message}`);
    }
  }

  private getSolanaConnection(): Solana.Connection {
    const { solanaGatewayUrl, solanaApiKey } = Config.blockchain.solana;
    const url = `${solanaGatewayUrl}/${solanaApiKey ?? ''}`;
    return new Solana.Connection(url);
  }

  // --- TRON --- //

  private async createTronTransaction(
    fromAddress: string,
    toAddress: string,
    amount: number,
    asset: Asset | null,
  ): Promise<UnsignedTransactionDto> {
    const url = Config.blockchain.tron.tronGatewayUrl;

    if (!asset || asset.type === AssetType.COIN) {
      // Native TRX transfer
      const response = await this.http.post<any>(
        `${url}/wallet/createtransaction`,
        {
          owner_address: fromAddress,
          to_address: toAddress,
          amount: Math.floor(amount * 1e6), // TRX to SUN
          visible: true,
        },
        this.tronHttpConfig(),
      );

      return {
        rawTransaction: JSON.stringify(response),
        encoding: 'hex',
        expiration: response.raw_data?.expiration,
      };
    } else {
      // TRC20 Token transfer
      const decimals = asset.decimals ?? 6;
      const tokenAmount = BigInt(Math.floor(amount * Math.pow(10, decimals)));
      const amountHex = tokenAmount.toString(16).padStart(64, '0');
      const toAddressHex = this.tronAddressToHex(toAddress).padStart(64, '0');
      const parameter = toAddressHex + amountHex;

      const response = await this.http.post<any>(
        `${url}/wallet/triggersmartcontract`,
        {
          owner_address: fromAddress,
          contract_address: asset.chainId,
          function_selector: 'transfer(address,uint256)',
          parameter,
          fee_limit: Config.blockchain.tron.sendTokenFeeLimit,
          call_value: 0,
          visible: true,
        },
        this.tronHttpConfig(),
      );

      return {
        rawTransaction: JSON.stringify(response.transaction),
        encoding: 'hex',
        expiration: response.transaction?.raw_data?.expiration,
      };
    }
  }

  private async broadcastTronTransaction(signedTransaction: string): Promise<BroadcastResultDto> {
    const url = Config.blockchain.tron.tronGatewayUrl;

    const tx = JSON.parse(signedTransaction);

    const response = await this.http.post<any>(`${url}/wallet/broadcasttransaction`, tx, this.tronHttpConfig());

    if (!response.result) {
      throw new BadRequestException(`Failed to broadcast Tron transaction: ${response.message || 'Unknown error'}`);
    }

    return { txHash: response.txid };
  }

  private tronAddressToHex(address: string): string {
    return TronWeb.address.toHex(address).replace(/^41/, '');
  }

  private tronHttpConfig() {
    return {
      headers: {
        'x-api-key': Config.blockchain.tron.tronApiKey,
        'Content-Type': 'application/json',
      },
    };
  }
}
