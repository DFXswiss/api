import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { VersionDto } from './version.dto';

@Injectable()
export class VersionService {
  private cachedVersion: VersionDto;

  getVersion(): VersionDto {
    if (!this.cachedVersion) {
      this.cachedVersion = this.loadVersionInfo();
    }
    return this.cachedVersion;
  }

  private loadVersionInfo(): VersionDto {
    try {
      const versionFilePath = join(process.cwd(), 'dist', 'version.json');
      const versionData = JSON.parse(readFileSync(versionFilePath, 'utf-8'));
      return versionData;
    } catch (error) {
      // Fallback if version.json doesn't exist (e.g., in development)
      return {
        commit: 'unknown',
        branch: 'unknown',
        version: 'unknown',
        buildTime: 'unknown',
      };
    }
  }
}
