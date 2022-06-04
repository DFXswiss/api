import { Injectable, NotFoundException } from '@nestjs/common';
import { MasternodeRepository } from 'src/payment/models/masternode/masternode.repository';
import { IsNull, LessThan, MoreThan } from 'typeorm';
import { CreateMasternodeDto } from './dto/create-masternode.dto';
import { ResignMasternodeDto } from './dto/resign-masternode.dto';
import { Masternode } from './masternode.entity';

@Injectable()
export class MasternodeService {
  constructor(private readonly masternodeRepo: MasternodeRepository) {}

  async get(): Promise<Masternode[]> {
    return this.masternodeRepo.find();
  }

  async create(dto: CreateMasternodeDto): Promise<Masternode> {
    const masternode = this.masternodeRepo.create(dto);
    masternode.enabled = true;
    masternode.creationHash = dto.hash;
    masternode.creationDate = new Date();
    return this.masternodeRepo.save(masternode);
  }

  async resign(hash: string, dto: ResignMasternodeDto): Promise<Masternode> {
    const masternode = await this.masternodeRepo.findOne({ creationHash: hash });
    if (!masternode) throw new NotFoundException('Masternode not found');

    masternode.enabled = false;
    return await this.masternodeRepo.save({ ...masternode, ...dto });
  }

  async getCount(): Promise<number> {
    return this.masternodeRepo.count();
  }

  async getActiveCount(date: Date = new Date()): Promise<number> {
    return this.masternodeRepo.count({
      where: [
        { creationDate: LessThan(date), resignDate: IsNull() },
        { creationDate: LessThan(date), resignDate: MoreThan(date) },
      ],
    });
  }

  async getActive(): Promise<Masternode[]> {
    return this.masternodeRepo.find({ where: { enabled: true } });
  }

  async getFreeOperators(): Promise<number> {
    return await this.masternodeRepo.count({ where: { creationHash: IsNull() } });
  }
}
