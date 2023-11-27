export interface IdentConfig {
  customer: string;
  apiKey: string;
}

export interface IdentDocument {
  name: string;
  content: Buffer;
}

export interface IdentDocuments {
  pdf: IdentDocument;
  zip: IdentDocument;
}
