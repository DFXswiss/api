export interface IknaAddressTagResult {
  address_tags: IknaAddressTag[];
}

export interface IknaAddressTag {
  abuse?: string;
  actor?: string;
  category?: string;
  confidence?: string;
  confidence_level?: number;
  currency: string;
  is_cluster_definer: boolean;
  label: string;
  lastmod?: number;
  source?: string;
  tagpack_creator: string;
  tagpack_is_public: boolean;
  tagpack_title: string;
  tagpack_uri?: string;
  address: string;
  entity: number;
}
