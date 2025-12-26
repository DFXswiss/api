import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { merge } from 'lodash';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PaymentLink } from 'src/subdomains/core/payment-link/entities/payment-link.entity';
import { FindOneOptions, In } from 'typeorm';
import { DepositRoute } from './deposit-route.entity';
import { DepositRouteRepository } from './deposit-route.repository';

@Injectable()
export class DepositRouteService {
  private readonly logger = new DfxLogger(DepositRouteService);

  constructor(private readonly depositRouteRepo: DepositRouteRepository) {}

  async get(userId: number, id: number): Promise<DepositRoute> {
    const routes = await this.depositRouteRepo.findOne({
      where: { id, user: { id: userId } },
      relations: { user: { userData: true } },
    });
    if (!routes) throw new NotFoundException('Route not found');
    return routes;
  }

  async getById(id: number, options?: FindOneOptions<DepositRoute>): Promise<DepositRoute> {
    const defaultOptions = { where: { id }, relations: { user: { userData: true } } };
    return this.depositRouteRepo.findOne(merge(defaultOptions, options));
  }

  async getLatest(userId: number): Promise<DepositRoute | null> {
    return this.depositRouteRepo.findOne({
      where: { user: { id: userId } },
      relations: { user: { userData: true } },
      order: { created: 'DESC' },
    });
  }

  async getByLabel(userId: number, label: string, options?: FindOneOptions<DepositRoute>): Promise<DepositRoute> {
    const defaultOptions = {
      where: { route: { label }, user: { id: userId } },
      relations: { user: { userData: true } },
    };
    return this.depositRouteRepo.findOne(merge(defaultOptions, options));
  }

  validateLightningRoute(route: DepositRoute): void {
    if (!route) throw new NotFoundException('Route not found');
    if (route.deposit.blockchains !== Blockchain.LIGHTNING)
      throw new BadRequestException('Only Lightning routes are allowed');
  }

  async getPaymentRoute(idOrLabel: string, options?: FindOneOptions<DepositRoute>): Promise<DepositRoute> {
    const isRouteId = !isNaN(+idOrLabel);
    const route = isRouteId
      ? await this.getById(+idOrLabel, options)
      : await this.getByLabel(undefined, idOrLabel, options);

    try {
      this.validateLightningRoute(route);
    } catch (e) {
      this.logger.verbose(`Failed to validate route ${idOrLabel}:`, e);
      throw new NotFoundException(`Payment route not found`);
    }
    return route;
  }

  async getPaymentLinksFromRoute(
    routeIdOrLabel: string,
    externalIds?: string[],
    ids?: number[],
  ): Promise<PaymentLink[]> {
    const route = await this.getPaymentRoute(routeIdOrLabel, {
      relations: { paymentLinks: true },
      where: {
        paymentLinks: [
          ...(externalIds?.length ? [{ externalId: In(externalIds) }] : []),
          ...(ids?.length ? [{ id: In(ids) }] : []),
        ],
      },
      order: { paymentLinks: { created: 'ASC' } },
    });

    return Array.from(new Map((route.paymentLinks || []).map((l) => [l.id, l])).values());
  }

  async getPaymentRoutesForPublicName(publicName: string): Promise<DepositRoute[]> {
    return this.depositRouteRepo.find({
      where: {
        active: true,
        deposit: { blockchains: Blockchain.LIGHTNING },
        user: { userData: { paymentLinksName: publicName } },
      },
      relations: { user: { userData: true } },
    });
  }

  async getPaymentRouteForKey(key: string): Promise<DepositRoute | undefined> {
    return this.depositRouteRepo
      .createQueryBuilder('depositRoute')
      .innerJoin('depositRoute.deposit', 'deposit')
      .innerJoinAndSelect('depositRoute.user', 'user')
      .innerJoinAndSelect('user.userData', 'userData')
      .where(
        `EXISTS (SELECT 1 FROM OPENJSON(userdata.paymentLinksConfig, '$.accessKeys') AS k WHERE k.value = :key )`,
        { key },
      )
      .andWhere('depositRoute.active = 1')
      .andWhere('deposit.blockchains = :chain', { chain: Blockchain.LIGHTNING })
      .getOne();
  }
}
