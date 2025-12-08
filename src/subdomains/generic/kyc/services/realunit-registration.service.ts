import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { RealUnitRegistrationDto } from '../dto/input/realunit-registration.dto';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName } from '../enums/kyc-step-name.enum';
import { ReviewStatus } from '../enums/review-status.enum';
import { KycStepRepository } from '../repositories/kyc-step.repository';

@Injectable()
export class RealUnitRegistrationService {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly kycStepRepo: KycStepRepository,
    private readonly cryptoService: CryptoService,
  ) {}

  async register(userDataId: number, dto: RealUnitRegistrationDto): Promise<KycStep> {
    // 1. Get UserData with users
    const userData = await this.userDataService.getUserData(userDataId, { users: true, kycSteps: true });
    if (!userData) throw new NotFoundException('User not found');

    // 2. Verify walletAddress belongs to user
    const walletBelongsToUser = userData.users.some(
      (u) => u.address.toLowerCase() === dto.walletAddress.toLowerCase(),
    );
    if (!walletBelongsToUser) throw new BadRequestException('Wallet address does not belong to user');

    // 3. Verify EIP-712 signature
    const signatureData = {
      email: dto.email,
      name: dto.name,
      type: dto.type,
      phoneNumber: dto.phoneNumber,
      birthday: dto.birthday,
      nationality: dto.nationality,
      addressStreet: dto.addressStreet,
      addressPostalCode: dto.addressPostalCode,
      addressCity: dto.addressCity,
      addressCountry: dto.addressCountry,
      swissTaxResidence: dto.swissTaxResidence,
      registrationDate: dto.registrationDate,
      walletAddress: dto.walletAddress,
    };

    const isValidSignature = this.cryptoService.verifyRealUnitRegistrationSignature(signatureData, dto.signature);
    if (!isValidSignature) throw new BadRequestException('Invalid signature');

    // 4. Check for existing registration (any non-failed status)
    const existingStep = userData.kycSteps?.find(
      (s) => s.name === KycStepName.REALUNIT_REGISTRATION &&
        ![ReviewStatus.FAILED, ReviewStatus.CANCELED].includes(s.status),
    );
    if (existingStep) throw new BadRequestException('RealUnit registration already exists');

    // 5. Create KycStep
    const nextSequenceNumber = userData.kycSteps
      ? Math.max(0, ...userData.kycSteps.filter((s) => s.name === KycStepName.REALUNIT_REGISTRATION).map((s) => s.sequenceNumber)) + 1
      : 1;

    const kycStep = this.kycStepRepo.create({
      userData,
      name: KycStepName.REALUNIT_REGISTRATION,
      status: ReviewStatus.INTERNAL_REVIEW,
      sequenceNumber: nextSequenceNumber,
      result: JSON.stringify(dto),
    });

    return this.kycStepRepo.save(kycStep);
  }
}
