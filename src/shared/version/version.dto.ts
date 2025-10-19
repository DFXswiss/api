import { ApiProperty } from '@nestjs/swagger';

export class VersionDto {
  @ApiProperty({ description: 'Git commit hash' })
  commit: string;

  @ApiProperty({ description: 'Git branch name' })
  branch: string;

  @ApiProperty({ description: 'API version from package.json' })
  version: string;

  @ApiProperty({ description: 'Build timestamp' })
  buildTime: string;
}
