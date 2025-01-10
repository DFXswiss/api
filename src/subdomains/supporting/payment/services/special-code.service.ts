import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateSpecialCodeDto } from '../dto/input/create-special-code.dto';
import { SpecialCode } from '../entities/special-code.entity';
import { SpecialCodeRepository } from '../repositories/special-code.repository';

@Injectable()
export class SpecialCodeService {
  constructor(private readonly specialCodeRepo: SpecialCodeRepository) {}

  async createSpecialCode(dto: CreateSpecialCodeDto): Promise<SpecialCode> {
    const existing = await this.specialCodeRepo.findOneBy({ code: dto.code });
    if (existing) throw new BadRequestException('Special code already created');

    const specialCode = this.specialCodeRepo.create(dto);

    return this.specialCodeRepo.save(specialCode);
  }
}
