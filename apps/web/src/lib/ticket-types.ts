export interface CatalogItem {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  color?: string;
  kind?: 'OPEN' | 'RESOLVED' | 'TERMINAL';
  pausesSla?: boolean;
}

export interface TicketCatalogs {
  types: (CatalogItem & { categories: CatalogItem[] })[];
  urgencies: CatalogItem[];
  statuses: CatalogItem[];
  transitions: { id: string; from: string; to: string; requiredPermissionKey: string | null }[];
  updateTypes: CatalogItem[];
  resolutionCategories: CatalogItem[];
  slaPolicies: {
    id: string;
    firstResponseMinutes: number;
    resolutionMinutes: number;
    warningThresholdPct: number;
    type: CatalogItem;
    urgency: CatalogItem;
  }[];
}

export interface UserRef {
  id: string;
  nameAr: string;
  nameEn: string;
  email?: string;
}

export interface TicketRow {
  id: string;
  internalNumber: string;
  customerComplaintNumber: string;
  customerName: string;
  customerPhone: string;
  subject: string;
  description?: string;
  relatedOrderNo?: string | null;
  sapMaterialNo?: string | null;
  itemNameAr?: string | null;
  itemNameEn?: string | null;
  type: CatalogItem;
  category: CatalogItem;
  urgency: CatalogItem;
  status: CatalogItem;
  branch: { id: string; code: string; nameAr: string; nameEn: string } | null;
  branchSupervisorSnapshot: { name?: string; email?: string; phone?: string } | null;
  createdBy: UserRef;
  responsible: UserRef | null;
  teams: { team: { id: string; nameAr: string; nameEn: string } }[];
  slaState: 'ON_TRACK' | 'WARNING' | 'BREACHED' | 'PAUSED' | 'MET';
  resolutionDueAt: string | null;
  reopenCount: number;
  createdAt: string;
}

export interface TicketDetail extends TicketRow {
  updates: {
    id: string;
    body: string;
    createdAt: string;
    updateType: CatalogItem;
    author: UserRef;
  }[];
  resolution: {
    summary: string;
    rootCause: string;
    actionTaken: string;
    finalSolution: string;
    customerInformed: boolean;
    resolvedAt: string;
    resolutionCategory: CatalogItem;
  } | null;
  ownerships: { user: UserRef; fromAt: string; toAt: string | null; reason: string | null }[];
  timeline: {
    id: string;
    eventType: string;
    payload: Record<string, unknown> | null;
    createdAt: string;
  }[];
  attachments: { id: string; fileName: string; sizeBytes: number }[];
}

export interface BranchRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  city: string | null;
  phone: string | null;
  supervisorName: string | null;
  supervisorEmail: string | null;
  supervisorPhone: string | null;
  areaManagerName: string | null;
  areaManagerEmail: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}
