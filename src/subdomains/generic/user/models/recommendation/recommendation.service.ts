import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull, MoreThan } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';
import { KycLevel, KycType, UserDataStatus } from '../user-data/user-data.enum';
import { UserDataService } from '../user-data/user-data.service';
import { UserService } from '../user/user.service';
import { CreateRecommendationDto } from './dto/recommendation.dto';
import { Recommendation, RecommendationMethod, RecommendationType } from './recommendation.entity';
import { RecommendationRepository } from './recommendation.repository';

@Injectable()
export class RecommendationService {
  private readonly logger = new DfxLogger(RecommendationService);

  constructor(
    private readonly recommendationRepo: RecommendationRepository,
    private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => UserDataService))
    private readonly userDataService: UserDataService,
    private readonly userService: UserService,
  ) {}

  async createRecommendationByRecommender(userDataId: number, dto: CreateRecommendationDto): Promise<Recommendation> {
    const userData = await this.userDataService.getUserData(userDataId);
    if (!userData) throw new NotFoundException('Account not found');
    if (userData.kycLevel < KycLevel.LEVEL_50) throw new BadRequestException('Missing KYC');
    if (!userData.tradeApprovalDate) throw new BadRequestException('Trade approval date missing');

    const mailUser: UserData = dto.recommendedMail
      ? (await this.userDataService.getUsersByMail(dto.recommendedMail, true))?.[0]
      : undefined;

    if (mailUser && mailUser.tradeApprovalDate) throw new BadRequestException('Account is already approved');
    if (
      dto.recommendedMail &&
      (await this.recommendationRepo.existsBy({
        recommendedMail: dto.recommendedMail,
        isConfirmed: IsNull(),
        expirationDate: MoreThan(new Date()),
      }))
    )
      throw new BadRequestException('Another active recommendation for this mail exists');

    const existingRecommendations = dto.recommendedMail
      ? await this.recommendationRepo.countBy({ recommendedMail: dto.recommendedMail })
      : 0;
    if (existingRecommendations > Config.recommendation.maxRecommendationPerMail)
      throw new BadRequestException('Max amount of recommendations for this mail reached');

    const recommended = mailUser
      ? await this.userDataService.updateUserDataInternal(mailUser, { tradeApprovalDate: new Date() })
      : await this.userDataService.createUserData({
          mail: dto.recommendedMail,
          status: UserDataStatus.KYC_ONLY,
          kycType: KycType.DFX,
          language: userData.language,
          currency: userData.currency,
          tradeApprovalDate: new Date(),
        });

    const entity = await this.createRecommendationInternal(
      RecommendationType.INVITATION,
      dto.recommendedMail ? RecommendationMethod.MAIL : RecommendationMethod.RECOMMENDATION_CODE,
      userData,
      recommended,
      undefined,
      dto.recommendedAlias,
      dto.recommendedMail,
    );

    if (dto.recommendedMail) await this.sendInvitationMail(entity);

    return entity;
  }

  async handleRecommendationRequest(kycStep: KycStep, userData: UserData, key: string): Promise<void> {
    if (Config.formats.recommendationCode.test(key)) {
      // search for existing recommendation
      const recommendation = await this.getAndCheckRecommendationByCode(key);
      if (recommendation.recommender.id === userData.id)
        throw new Error('Recommender and recommended can not be the same account');
      if (recommendation.recommended?.id) throw new Error('Recommended already set');

      await this.updateRecommendationInternal(recommendation, {
        isConfirmed: true,
        recommended: userData,
        method: RecommendationMethod.RECOMMENDATION_CODE,
        kycStep,
        confirmationDate: new Date(),
      });
    } else {
      // create new recommendation
      const recommender: UserData = Config.formats.ref.test(key)
        ? await this.userService.getRefUser(key).then((u) => u?.userData)
        : key.includes('@')
        ? (await this.userDataService.getUsersByMail(key, true))?.[0]
        : undefined;
      if (!recommender) throw new NotFoundException('Recommender not found');
      if (recommender.isBlocked) throw new BadRequestException('Recommender blocked');
      if (recommender.kycLevel < KycLevel.LEVEL_50) throw new BadRequestException('Missing KYC');
      if (!recommender.tradeApprovalDate) throw new BadRequestException('Trade approval date missing');

      const existingRecommendations = await this.recommendationRepo.countBy({
        recommender: { id: recommender.id },
        recommended: { id: userData.id },
      });
      if (existingRecommendations > Config.recommendation.maxRecommendationPerMail)
        throw new BadRequestException('Max amount of recommendations for this account reached');

      const entity = await this.createRecommendationInternal(
        RecommendationType.REQUEST,
        Config.formats.ref.test(key) ? RecommendationMethod.REF_CODE : RecommendationMethod.MAIL,
        recommender,
        userData,
        kycStep,
      );

      await this.sendPendingConfirmationMail(entity);
    }
  }

  private async createRecommendationInternal(
    type: RecommendationType,
    method: RecommendationMethod,
    recommender: UserData,
    recommended?: UserData,
    kycStep?: KycStep,
    recommendedAlias?: string,
    recommendedMail?: string,
  ): Promise<Recommendation> {
    const hash = Util.createHash(new Date().toISOString() + recommender.id).toUpperCase();

    const entity = this.recommendationRepo.create({
      kycStep,
      type,
      method,
      recommendedAlias,
      recommendedMail,
      recommender,
      recommended,
      expirationDate:
        type === RecommendationType.INVITATION
          ? Util.daysAfter(Config.recommendation.recommenderExpiration)
          : Util.daysAfter(Config.recommendation.confirmationExpiration),
      code: `${hash.slice(0, 2)}-${hash.slice(2, 6)}-${hash.slice(6, 10)}-${hash.slice(10, 12)}`,
    });

    return this.recommendationRepo.save(entity);
  }

  async confirmRecommendation(userDataId: number, id: number, isConfirmed: boolean): Promise<Recommendation> {
    const entity = await this.recommendationRepo.findOne({ where: { id }, relations: { recommender: true } });
    if (!entity) throw new NotFoundException('Recommendation not found');
    if (entity.recommender.id !== userDataId)
      throw new BadRequestException('You can not confirm a recommendation from another account');
    if (entity.recommender.kycLevel < KycLevel.LEVEL_50) throw new BadRequestException('Missing kyc');
    if (!entity.recommender.tradeApprovalDate) throw new BadRequestException('TradeApprovalDate missing');
    if (entity.isConfirmed !== null) throw new BadRequestException('Recommendation is already confirmed');
    if (entity.isExpired) throw new BadRequestException('Recommendation is expired');

    return this.updateRecommendationInternal(entity, {
      isConfirmed,
      confirmationDate: isConfirmed ? new Date() : undefined,
    });
  }

  async updateRecommendationInternal(entity: Recommendation, update: Partial<Recommendation>): Promise<Recommendation> {
    Object.assign(entity, update);

    return this.recommendationRepo.save(entity);
  }

  async getAndCheckRecommendationByCode(code: string): Promise<Recommendation> {
    const entity = await this.recommendationRepo.findOne({
      where: { code },
      relations: { recommended: true, recommender: true },
    });
    if (!entity) throw new BadRequestException('Recommendation code not found');
    if (entity.isExpired) throw new BadRequestException('Recommendation code is expired');
    if (entity.isUsed) throw new BadRequestException('Recommendation code is already used');
    if (entity.type === RecommendationType.REQUEST) throw new BadRequestException('Recommendation code is not valid');
    if (!entity.recommender.tradeApprovalDate) throw new BadRequestException('Recommender is not approved yet');

    return entity;
  }

  async getAllRecommendationForUserData(userDataId: number): Promise<Recommendation[]> {
    return this.recommendationRepo.find({
      where: { recommender: { id: userDataId } },
      relations: { recommended: true, recommender: true },
    });
  }

  // --- NOTIFICATIONS --- //
  private async sendInvitationMail(entity: Recommendation): Promise<void> {
    try {
      if (entity.recommended.mail) {
        await this.notificationService.sendMail({
          type: MailType.USER_V2,
          context: MailContext.RECOMMENDATION_MAIL,
          input: {
            userData: entity.recommended,
            wallet: entity.recommended.wallet,
            title: `${MailTranslationKey.RECOMMENDATION_MAIL}.title`,
            salutation: { key: `${MailTranslationKey.RECOMMENDATION_MAIL}.salutation` },
            texts: [
              { key: MailKey.SPACE, params: { value: '3' } },
              {
                key: `${MailTranslationKey.GENERAL}.welcome`,
                params: { name: entity.recommendedAlias },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.RECOMMENDATION_MAIL}.message`,
                params: { name: entity.recommender.completeName, mail: entity.recommender.mail },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.RECOMMENDATION_MAIL}.registration_button`,
                params: { url: Config.frontend.services, button: 'true' },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.RECOMMENDATION_MAIL}.registration_link`,
                params: { url: Config.frontend.services, urlText: Config.frontend.services },
              },
              { key: MailKey.SPACE, params: { value: '4' } },
              { key: MailKey.DFX_TEAM_CLOSING },
            ],
          },
        });
      } else {
        this.logger.warn(`Failed to send recommendation (${entity.id}) recommender mail: user has no email`);
      }
    } catch (e) {
      this.logger.error(`Failed to send recommendation (${entity.id}) recommender mail:`, e);
    }
  }

  private async sendPendingConfirmationMail(entity: Recommendation): Promise<void> {
    try {
      if (entity.recommender.mail) {
        await this.notificationService.sendMail({
          type: MailType.USER_V2,
          context: MailContext.RECOMMENDATION_CONFIRMATION,
          input: {
            userData: entity.recommender,
            wallet: entity.recommender.wallet,
            title: `${MailTranslationKey.RECOMMENDATION_CONFIRMATION}.title`,
            salutation: { key: `${MailTranslationKey.RECOMMENDATION_CONFIRMATION}.salutation` },
            texts: [
              { key: MailKey.SPACE, params: { value: '3' } },
              {
                key: `${MailTranslationKey.GENERAL}.welcome`,
                params: { name: entity.recommender.firstname },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.RECOMMENDATION_CONFIRMATION}.message`,
                params: { name: entity.recommended.completeName, mail: entity.recommended.mail },
              },
              { key: MailKey.SPACE, params: { value: '5' } },
              { key: `${MailTranslationKey.RECOMMENDATION_CONFIRMATION}.warning` },
              { key: MailKey.SPACE, params: { value: '4' } },
              {
                key: `${MailTranslationKey.RECOMMENDATION_CONFIRMATION}.button`,
                params: { url: entity.url, button: 'true' },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.RECOMMENDATION_CONFIRMATION}.link`,
                params: { url: entity.url, urlText: entity.url },
              },
              { key: MailKey.SPACE, params: { value: '4' } },
              { key: MailKey.DFX_TEAM_CLOSING },
            ],
          },
        });
      } else {
        this.logger.warn(`Failed to send recommendation (${entity.id}) confirmation mail: user has no email`);
      }
    } catch (e) {
      this.logger.error(`Failed to send recommendation (${entity.id}) confirmation mail:`, e);
    }
  }
}
