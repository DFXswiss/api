import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { VersionDto } from './version.dto';

@Injectable()
export class VersionService {
  private cachedVersion: VersionDto;

  getVersion(): VersionDto {
    if (!this.cachedVersion) {
      this.cachedVersion = this.buildVersionInfo();
    }
    return this.cachedVersion;
  }

  private buildVersionInfo(): VersionDto {
    const commit = this.getGitCommit();
    const branch = this.getGitBranch();
    const version = this.getPackageVersion();
    const buildTime = new Date().toISOString();

    return {
      commit,
      branch,
      version,
      buildTime,
    };
  }

  private getGitCommit(): string {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    } catch (error) {
      return 'unknown';
    }
  }

  private getGitBranch(): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch (error) {
      return 'unknown';
    }
  }

  private getPackageVersion(): string {
    try {
      const packageJsonPath = join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      return packageJson.version || 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }
}
