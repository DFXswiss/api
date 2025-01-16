import { BadRequestException, Injectable } from '@nestjs/common';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { CreateSpecialCodeDto } from '../dto/input/create-special-code.dto';
import { SpecialCode } from '../entities/special-code.entity';
import { FeeRepository } from '../repositories/fee.repository';
import { SpecialCodeRepository } from '../repositories/special-code.repository';

@Injectable()
export class SpecialCodeService {
  constructor(
    private readonly specialCodeRepo: SpecialCodeRepository,
    private readonly userDataService: UserDataService,
    private readonly feeRepo: FeeRepository,
  ) {}

  async createSpecialCode(dto: CreateSpecialCodeDto): Promise<SpecialCode> {
    const existing = await this.specialCodeRepo.findOneBy({ code: dto.code });
    if (existing) throw new BadRequestException('Special code already created');

    const specialCode = this.specialCodeRepo.create(dto);

    return this.specialCodeRepo.save(specialCode);
  }

  async addSpecialCodeUser(user: User, specialCode: string): Promise<void> {
    const cachedSpecialCode = await this.specialCodeRepo.findOneCached(specialCode, {
      where: { code: specialCode },
      relations: { fees: true },
    });

    for (const fee of cachedSpecialCode.fees) {
      await this.feeRepo.update(...fee.increaseUsage(user.userData.accountType, user.wallet));
    }

    await this.userDataService.addFee(user.userData, cachedSpecialCode.id);
  }
}
