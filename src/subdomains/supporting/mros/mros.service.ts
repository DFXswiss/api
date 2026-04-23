import { Injectable, NotFoundException } from '@nestjs/common';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { CreateMrosDto } from './dto/create-mros.dto';
import { UpdateMrosDto } from './dto/update-mros.dto';
import { Mros } from './mros.entity';
import { MrosRepository } from './mros.repository';

@Injectable()
export class MrosService {
  constructor(private readonly repo: MrosRepository, private readonly userDataService: UserDataService) {}

  async create(dto: CreateMrosDto): Promise<Mros> {
    const entity = this.repo.create(dto);

    entity.userData = await this.userDataService.getUserData(dto.userDataId);
    if (!entity.userData) throw new NotFoundException('UserData not found');

    return this.repo.save(entity);
  }

  async update(id: number, dto: UpdateMrosDto): Promise<Mros> {
    const entity = await this.repo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Mros not found');

    return this.repo.save({ ...entity, ...dto });
  }

  async getAll(): Promise<Mros[]> {
    return this.repo.find({ relations: { userData: true } });
  }

  async getById(id: number): Promise<Mros> {
    const entity = await this.repo.findOne({ where: { id }, relations: { userData: true } });
    if (!entity) throw new NotFoundException('Mros not found');

    return entity;
  }
}
