export enum FrickVirtualIbanState {
  PREPARED = 'PREPARED',
  ACTIVE = 'ACTIVE',
  DEACTIVATION_REQUESTED = 'DEACTIVATION_REQUESTED',
  DEACTIVATED = 'DEACTIVATED',
}

export interface FrickVirtualIbanAddress {
  street: string;
  number: string;
  postalCode: string;
  city: string;
  country: string;
}

export interface FrickCreateVirtualIbanRequest {
  referenceAccountIban: string;
  name?: string;
  description?: string;
  address?: FrickVirtualIbanAddress;
}

export interface FrickVirtualIbanApproval {
  contactNumber: number;
  createdAt: string;
  createdBy: string;
  signatureGroup: number;
  signatureType: string;
}

export interface FrickVirtualIban {
  vban: string;
  referenceAccountIban: string;
  state: FrickVirtualIbanState;
  createdAt: string;
  createdBy: string;
  activationApprovals: FrickVirtualIbanApproval[];
  deactivationApprovals: FrickVirtualIbanApproval[];
  name?: string;
  description?: string;
  address?: FrickVirtualIbanAddress;
}

export interface FrickVirtualIbansResponse {
  pagination: { hasMore: boolean; pageIndex: number; pageSize: number; totalCount: number };
  virtualIbans: FrickVirtualIban[];
}

export interface FrickApproveVirtualIbanActivationRequest {
  vban: string;
}

export interface FrickDeactivateVirtualIbanRequest {
  vban: string;
}

export interface FrickApproveVirtualIbanDeactivationRequest {
  vban: string;
}
