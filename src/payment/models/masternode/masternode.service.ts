import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MasternodeRepository } from 'src/payment/models/masternode/masternode.repository';
import { IsNull, LessThan, MoreThan, Not } from 'typeorm';
import { CreateMasternodeDto } from './dto/create-masternode.dto';
import { ResignMasternodeDto } from './dto/resign-masternode.dto';
import { Masternode } from './masternode.entity';

@Injectable()
export class MasternodeService {
  constructor(private readonly masternodeRepo: MasternodeRepository) {}

  async get(): Promise<Masternode[]> {
    return this.masternodeRepo.find();
  }

  async create(id: number, dto: CreateMasternodeDto): Promise<Masternode> {
    const masternode = await this.masternodeRepo.findOne(id);
    if (!masternode) throw new NotFoundException('Masternode not found');
    if (masternode.creationHash) throw new ConflictException('Masternode already created');

    return await this.masternodeRepo.save({ ...masternode, ...dto });
  }

  async resign(id: number, dto: ResignMasternodeDto): Promise<Masternode> {
    const masternode = await this.masternodeRepo.findOne(id);
    if (!masternode) throw new NotFoundException('Masternode not found');
    if (!masternode.creationHash) throw new ConflictException('Masternode not yet created');
    if (masternode.resignHash) throw new ConflictException('Masternode already resigned');

    return await this.masternodeRepo.save({ ...masternode, ...dto });
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
    return this.masternodeRepo.find({ where: { creationHash: Not(IsNull()), resignHash: IsNull() } });
  }

  async getFreeOperatorCount(): Promise<number> {
    return await this.masternodeRepo.count({ where: { creationHash: IsNull() } });
  }
}
