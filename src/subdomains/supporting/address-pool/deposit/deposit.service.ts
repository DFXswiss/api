import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { DepositRepository } from 'src/subdomains/supporting/address-pool/deposit/deposit.repository';
import { Deposit } from './deposit.entity';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Config } from 'src/config/config';

@Injectable()
export class DepositService {
  constructor(private depositRepo: DepositRepository) {}

  async getDeposit(id: number): Promise<Deposit> {
    return this.depositRepo.findOneBy({ id });
  }

  async getDepositByAddress({ address, blockchain }: BlockchainAddress): Promise<Deposit> {
    return this.depositRepo.findOneBy({ address, blockchain });
  }

  async getAllDeposit(): Promise<Deposit[]> {
    return this.depositRepo.find();
  }

  async getNextDeposit(blockchain: Blockchain): Promise<Deposit> {
    // does not work with find options
    const deposit = await this.depositRepo
      .createQueryBuilder('deposit')
      .leftJoin('deposit.route', 'route')
      .where('route.id IS NULL AND deposit.blockchain = :blockchain', { blockchain })
      .getOne();
    if (!deposit) throw new InternalServerErrorException(`No unused deposit for ${blockchain} found`);

    return deposit;
  }

  async createDeposits({ blockchain, count }: CreateDepositDto): Promise<void> {
    const { ARBITRUM, OPTIMISM, ETHEREUM, BINANCE_SMART_CHAIN } = Blockchain;

    if (![ARBITRUM, OPTIMISM, ETHEREUM, BINANCE_SMART_CHAIN].includes(blockchain)) {
      throw new BadRequestException(
        'Creating random address is supported only for ARBITRUM, OPTIMISM, ETHEREUM and BINANCE_SMART_CHAIN.',
      );
    }

    const lastDeposit = await this.depositRepo.findOne({ where: { blockchain }, order: { accountIndex: 'DESC' } });
    const nextAccountIndex = (lastDeposit?.accountIndex ?? -1) + 1;

    for (let i = 0; i < count; i++) {
      const accountIndex = nextAccountIndex + i;

      const wallet = EvmUtil.createWallet(Config.blockchain.evm.walletAccount(accountIndex));
      const deposit = Deposit.create(wallet.address, blockchain, accountIndex);
      await this.depositRepo.save(deposit);
    }
  }
}
