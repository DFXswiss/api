import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { UserData } from '../user-data/user-data.entity';
import { UserDataService } from '../user-data/user-data.service';
import { CreateUserDataRelationDto, CreateUserDataRelationInternalDto } from './dto/create-user-data-relation.dto';
import { UpdateUserDataRelationDto } from './dto/update-user-data-relation.dto';
import { UserDataRelation } from './user-data-relation.entity';
import { UserDataRelationRepository } from './user-data-relation.repository';

@Injectable()
export class UserDataRelationService {
  constructor(
    private readonly userDataRelationRepo: UserDataRelationRepository,
    @Inject(forwardRef(() => UserDataService))
    private readonly userDataService: UserDataService,
  ) {}

  async createUserDataRelation(dto: CreateUserDataRelationDto): Promise<UserDataRelation> {
    const userDataRelation = this.userDataRelationRepo.create(dto);

    const account = await this.userDataService.getUserData(dto.account.id);
    if (!userDataRelation.account) throw new NotFoundException('Account not found');

    const relatedAccount = await this.userDataService.getUserData(dto.relatedAccount.id);
    if (!userDataRelation.relatedAccount) throw new NotFoundException('Related account not found');

    return this.createUserDataRelationInternal(account, relatedAccount, dto);
  }

  async createUserDataRelationInternal(
    account: UserData,
    relatedAccount: UserData,
    dto: CreateUserDataRelationInternalDto,
  ): Promise<UserDataRelation> {
    const userDataRelation = this.userDataRelationRepo.create({ account, relatedAccount, ...dto });

    return this.userDataRelationRepo.save(userDataRelation);
  }

  async updateUserDataRelation(userDataRelationId: number, dto: UpdateUserDataRelationDto): Promise<UserDataRelation> {
    const userDataRelation = await this.userDataRelationRepo.findOneBy({ id: userDataRelationId });
    if (!userDataRelation) throw new NotFoundException('User data relation not found');

    await this.userDataRelationRepo.update(userDataRelation.id, dto);
    Object.assign(userDataRelation, dto);

    return userDataRelation;
  }

  async deleteUserDataRelation(id: number): Promise<void> {
    await this.userDataRelationRepo.delete(id);
  }
}
