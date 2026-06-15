import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RealUnitRegistration } from './realunit-registration.entity';
import { User } from './user.entity';

@Injectable()
export class RealUnitService {
  constructor(
    @InjectRepository(RealUnitRegistration)
    private readonly realUnitRegistrationRepository: Repository<RealUnitRegistration>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findRegistrationStep(userDataId: number, walletAddress: string): Promise<RealUnitRegistration | null> {
    return this.realUnitRegistrationRepository.findOne({
      where: { userDataId, walletAddress },
    });
  }

  async completeRegistration(userDataId: number, walletAddress: string): Promise<RealUnitRegistration> {
    const existingRegistration = await this.findRegistrationStep(userDataId, walletAddress);
    if (existingRegistration) {
      // Update existing registration
      existingRegistration.status = 'COMPLETED';
      return this.realUnitRegistrationRepository.save(existingRegistration);
    } else {
      // Create new registration
      const newRegistration = this.realUnitRegistrationRepository.create({
        userDataId,
        walletAddress,
        status: 'COMPLETED',
      });
      return this.realUnitRegistrationRepository.save(newRegistration);
    }
  }
}