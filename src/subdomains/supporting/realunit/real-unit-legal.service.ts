import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { RealUnitLegalDtoMapper } from './dto/real-unit-legal-dto.mapper';
import { RealUnitLegalInfoDto } from './dto/real-unit-legal.dto';
import { RealUnitLegalAcceptance } from './entities/real-unit-legal-acceptance.entity';
import { RealUnitLegalAgreement } from './enums/real-unit-legal-agreement.enum';
import { RealUnitLegalAcceptanceRepository } from './repositories/real-unit-legal-acceptance.repository';

@Injectable()
export class RealUnitLegalService {
  constructor(private readonly repo: RealUnitLegalAcceptanceRepository) {}

  // --- LEGAL ACCEPTANCE --- //

  async getLegalInfo(userData: UserData): Promise<RealUnitLegalInfoDto> {
    // One SQL-filtered lookup per agreement (latest accepted row), never load-all-then-filter.
    const latestAcceptances = await Promise.all(
      Object.values(RealUnitLegalAgreement).map((agreement) => this.getLatestAcceptance(userData, agreement)),
    );

    return RealUnitLegalDtoMapper.toInfoDto(latestAcceptances.filter((a): a is RealUnitLegalAcceptance => a != null));
  }

  async acceptLegal(userData: UserData, agreements: RealUnitLegalAgreement[]): Promise<RealUnitLegalInfoDto> {
    // Dedupe so a repeated agreement in one request costs at most one write attempt.
    for (const agreement of new Set(agreements)) {
      // Always stamp the current server-side version — a client-sent version is never trusted.
      const version = Config.blockchain.realunit.legalVersions[agreement];

      // Fast path: skip the write when this exact version is already on record (the common re-accept case),
      // so re-accepting does not churn the DB or the error log.
      const alreadyAccepted = await this.repo.exists({
        where: { userData: { id: userData.id }, agreement, version },
      });
      if (alreadyAccepted) continue;

      try {
        await this.repo.save(this.repo.create({ userData, agreement, version, acceptedDate: new Date() }));
      } catch (e) {
        // Concurrency backstop: a parallel request committed the same (userData, agreement, version) between the
        // exists check and this insert. The unique index rejects it — treat that as the intended no-op, never a
        // 500; any other failure still propagates.
        if (!this.isUniqueViolation(e)) throw e;
      }
    }

    return this.getLegalInfo(userData);
  }

  // --- HELPER METHODS --- //

  private async getLatestAcceptance(
    userData: UserData,
    agreement: RealUnitLegalAgreement,
  ): Promise<RealUnitLegalAcceptance | null> {
    return this.repo.findOne({
      where: { userData: { id: userData.id }, agreement },
      order: { created: 'DESC', id: 'DESC' },
    });
  }

  // Postgres unique_violation (SQLSTATE 23505): a concurrent caller already committed this acceptance.
  private isUniqueViolation(error: unknown): boolean {
    return (error as { code?: string })?.code === '23505';
  }
}
