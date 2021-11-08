import { Client, AccessOptions, FileInfo } from 'basic-ftp';
import { readFile } from 'fs';

export class FtpService {
  private readonly tmpFile = 'tmp';

  private constructor(private client: Client) {}

  // client operations
  static async connect(options: AccessOptions & { directory?: string }): Promise<FtpService> {
    const client = new Client();
    await client.access(options);
    if (options.directory) {
      await client.cd(options.directory);
    }
    return new FtpService(client);
  }

  close() {
    this.client.close();
  }

  // file operations
  async listFiles(): Promise<FileInfo[]> {
    return this.client.list().then((l) => l.filter((i) => i.isFile));
  }

  async readFile(fileInfo: FileInfo): Promise<string> {
    await this.client.downloadTo(this.tmpFile, fileInfo.name);
    return this.readFileFromDisk(this.tmpFile);
  }

  async moveFile(file: string, directory: string, newFile?: string) {
    await this.ensureDir(directory);
    return this.client.rename(file, `${directory}/${newFile ?? file}`);
  }

  // --- HELPER METHODS --- //
  private async readFileFromDisk(fileName: string): Promise<string> {
    return new Promise((resolve, reject) =>
      readFile(fileName, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data.toString());
        }
      }),
    );
  }

  private async ensureDir(directory: string): Promise<void> {
    const current = await this.client.pwd();
    await this.client.ensureDir(directory);
    await this.client.cd(current);
  }
}
