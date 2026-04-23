import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BitcoinUtxo, BitcoinUtxoStatus } from '../entities/bitcoin-utxo.entity';
import { BitcoinUtxoRepository } from '../repositories/bitcoin-utxo.repository';

@Injectable()
export class BitcoinUtxoService {
  private readonly logger = new DfxLogger(BitcoinUtxoService);

  constructor(private readonly utxoRepo: BitcoinUtxoRepository) {}

  async getByTxidAndVout(txid: string, vout: number): Promise<BitcoinUtxo | null> {
    return this.utxoRepo.findOneBy({ txid, vout });
  }

  async getByStatus(status: BitcoinUtxoStatus): Promise<BitcoinUtxo[]> {
    return this.utxoRepo.findBy({ status });
  }

  async createOrUpdate(data: Partial<BitcoinUtxo> & { txid: string; vout: number }): Promise<BitcoinUtxo> {
    const existing = await this.getByTxidAndVout(data.txid, data.vout);

    if (existing) {
      Object.assign(existing, data);
      return this.utxoRepo.save(existing);
    }

    const utxo = this.utxoRepo.create(data);
    return this.utxoRepo.save(utxo);
  }

  async markSpent(txid: string, vout: number, spentInTxId: string): Promise<void> {
    const utxo = await this.getByTxidAndVout(txid, vout);
    if (!utxo) {
      this.logger.warn(`UTXO ${txid}:${vout} not found for marking as spent`);
      return;
    }

    utxo.status = BitcoinUtxoStatus.SPENT;
    utxo.spentInTxId = spentInTxId;
    await this.utxoRepo.save(utxo);
  }

  async getConfirmedUtxos(): Promise<BitcoinUtxo[]> {
    return this.getByStatus(BitcoinUtxoStatus.CONFIRMED);
  }
}
