import type { DataScope } from '@milaserv/contracts';

export interface Me {
  id: string;
  email: string;
  nameAr: string;
  nameEn: string;
  status: 'ACTIVE' | 'INACTIVE';
  mustChangePassword: boolean;
  department: { id: string; nameAr: string; nameEn: string } | null;
  roles: { key: string; nameAr: string; nameEn: string }[];
  teams: { id: string; nameAr: string; nameEn: string; role: string }[];
}

export interface EffectivePermissions {
  userId: string;
  departmentId: string | null;
  teamIds: string[];
  permissions: Record<string, { scope: DataScope; teamIds?: string[] }>;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserRow {
  id: string;
  email: string;
  nameAr: string;
  nameEn: string;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  lastSignInAt: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  department: { id: string; code: string; nameAr: string; nameEn: string } | null;
  roles: { role: { id: string; key: string; nameAr: string; nameEn: string } }[];
  teams: { role: string; team: { id: string; nameAr: string; nameEn: string } }[];
}

export interface DepartmentRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  status: 'ACTIVE' | 'INACTIVE';
  _count?: { teams: number };
}

export interface TeamRow {
  id: string;
  nameAr: string;
  nameEn: string;
  status: 'ACTIVE' | 'INACTIVE';
  department: { id: string; code: string; nameAr: string; nameEn: string };
  _count?: { members: number };
  members?: {
    role: string;
    user: { id: string; email: string; nameAr: string; nameEn: string; status: string };
  }[];
}

export interface RoleRow {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  isSystem: boolean;
  permissions: {
    dataScope: DataScope;
    scopeTeamIds: string[];
    permission: { id: string; key: string; module: string; labelAr: string; labelEn: string };
  }[];
  _count?: { users: number };
}

export interface PermissionRow {
  id: string;
  key: string;
  module: string;
  labelAr: string;
  labelEn: string;
}

export interface SettingRow {
  id: string;
  key: string;
  category: string;
  valueType: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';
  value: unknown;
  scopeLevel: 'SYSTEM' | 'DEPARTMENT' | 'TEAM';
  scopeId: string;
  labelAr: string;
  labelEn: string;
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string | null;
  bodyEn: string | null;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}
