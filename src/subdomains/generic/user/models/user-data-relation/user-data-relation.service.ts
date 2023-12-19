import { Injectable, NotFoundException } from '@nestjs/common';
import { UserDataService } from '../user-data/user-data.service';
import { CreateUserDataRelationDto } from './dto/create-user-data-relation.dto';
import { UserDataRelation } from './user-data-relation.entity';
import { UserDataRelationRepository } from './user-data-relation.repository';

@Injectable()
export class UserDataRelationService {
  constructor(
    private readonly userDataRelationRepo: UserDataRelationRepository,
    private readonly userDataService: UserDataService,
  ) {}

  async create(dto: CreateUserDataRelationDto): Promise<UserDataRelation> {
    const userDataRelation = this.userDataRelationRepo.create(dto);

    userDataRelation.account = await this.userDataService.getUserData(dto.account.id);
    if (!userDataRelation.account) throw new NotFoundException('Account not found');

    userDataRelation.relatedAccount = await this.userDataService.getUserData(dto.relatedAccount.id);
    if (!userDataRelation.relatedAccount) throw new NotFoundException('Related account not found');

    await this.userDataRelationRepo.save(userDataRelation);

    return userDataRelation;
  }

  async delete(id: number): Promise<void> {
    await this.userDataRelationRepo.delete(id);
  }
}
