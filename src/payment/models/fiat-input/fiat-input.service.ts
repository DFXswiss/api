import { Injectable } from '@nestjs/common';
import { FiatInput } from './fiat-input.entity';
import * as XmlParser from 'fast-xml-parser';

@Injectable()
export class FiatInputService {
  async storeSepaFiles(files: string[]): Promise<FiatInput[]> {
    const inputs = files.map((f) => this.parseSepaXml(f)).reduce((prev, curr) => prev.concat(curr), []);
    // TODO: batch

    return inputs;
  }

  // --- HELPER METHODS --- //
  private parseSepaXml(xmlFile: string): FiatInput[] {
    const validationResult = XmlParser.validate(xmlFile);
    if (validationResult !== true) {
      throw validationResult;
    }

    const xml = XmlParser.parse(xmlFile, { ignoreAttributes: false });
    console.log(xml);

    // TODO
    return [];
  }
}
