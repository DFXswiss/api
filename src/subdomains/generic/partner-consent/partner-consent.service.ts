import { Injectable } from '@nestjs/common';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { PartnerConsentRepository } from './partner-consent.repository';

export interface PartnerConsentEntry {
  topic: string;
  version: number;
}

@Injectable()
export class PartnerConsentService {
  constructor(private readonly repo: PartnerConsentRepository) {}

  // Highest accepted version per topic for the (userData, partner) pair.
  async getConfirmedVersions(userData: UserData, partner: Wallet): Promise<Map<string, number>> {
    const rows = await this.repo
      .createQueryBuilder('consent')
      .select('consent.topic', 'topic')
      .addSelect('MAX(consent.version)', 'version')
      .where('consent.userDataId = :userDataId', { userDataId: userData.id })
      .andWhere('consent.partnerId = :partnerId', { partnerId: partner.id })
      .groupBy('consent.topic')
      .getRawMany<{ topic: string; version: number }>();

    return new Map(rows.map((r) => [r.topic, Number(r.version)]));
  }

  // Topics whose required version the user has not accepted yet. The caller owns
  // the source of truth for required versions (e.g. partner config); this service
  // only compares it against what is stored.
  async getMissingTopics(userData: UserData, partner: Wallet, required: Map<string, number>): Promise<string[]> {
    const confirmed = await this.getConfirmedVersions(userData, partner);
    return [...required.entries()]
      .filter(([topic, version]) => (confirmed.get(topic) ?? 0) < version)
      .map(([topic]) => topic);
  }

  // Append-only: one new row per confirmed topic, stamped with the version the
  // caller passes in (the partner-side current version).
  async confirm(userData: UserData, partner: Wallet, entries: PartnerConsentEntry[]): Promise<void> {
    if (!entries.length) return;

    const consents = entries.map((e) =>
      this.repo.create({
        userData: { id: userData.id },
        partner: { id: partner.id },
        topic: e.topic,
        version: e.version,
      }),
    );
    await this.repo.save(consents);
  }
}
