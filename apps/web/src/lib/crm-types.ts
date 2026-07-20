export interface CrmCatalogItem {
  key: string;
  nameAr: string;
  nameEn: string;
}

export interface DispositionItem extends CrmCatalogItem {
  closesLead: boolean;
  requiresReschedule: boolean;
  createsOrder: boolean;
}

export interface CrmCatalogs {
  callStatuses: CrmCatalogItem[];
  dispositions: DispositionItem[];
  orderTypes: CrmCatalogItem[];
}

export type LeadStatus = 'NEW' | 'ASSIGNED' | 'CLOSED';

export interface LeadRow {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  notes: string | null;
  leadSource: string;
  partnerName: string | null;
  campaign: string | null;
  status: LeadStatus;
  assignedTo: { id: string; nameAr: string; nameEn: string } | null;
  batch: { id: string; fileName: string } | null;
  rescheduledAt: string | null;
  lastCallAt: string | null;
  closedDispositionKey: string | null;
  createdAt: string;
}

export interface PreviewResponse {
  counts: { valid: number; invalid: number; duplicates: number };
  rows: {
    index: number;
    name: string;
    phone: string;
    status: 'VALID' | 'INVALID' | 'DUPLICATE_FILE' | 'DUPLICATE_EXISTING';
    reason?: string;
  }[];
}

export interface ImportResponse {
  batchId: string;
  imported: number;
  skipped: { index: number; status: string; reason?: string }[];
}

export type OrderStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED';

export interface OrderRow {
  id: string;
  number: string;
  customerName: string;
  customerPhone: string;
  orderType: CrmCatalogItem;
  value: string;
  status: OrderStatus;
  createdBy: { id: string; nameAr: string; nameEn: string };
  createdAt: string;
}
