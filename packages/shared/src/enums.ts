export const UserRole = {
  ADMIN: "ADMIN",
  AGENT: "AGENT",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  LOCKED: "LOCKED",
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const AgentStatus = {
  AVAILABLE: "AVAILABLE",
  WORKING_ON_LEAD: "WORKING_ON_LEAD",
  ON_CALL: "ON_CALL",
  ON_BREAK: "ON_BREAK",
  STANDBY: "STANDBY",
  OFFLINE: "OFFLINE",
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

/** Lead workflow status only. Kept separate from call status / business outcome / task completion. */
export const LeadWorkflowStatus = {
  NEW: "NEW",
  ASSIGNED: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  CONTACTED: "CONTACTED",
  CALLBACK_REQUIRED: "CALLBACK_REQUIRED",
  INVALID_NUMBER: "INVALID_NUMBER",
  NOT_INTERESTED: "NOT_INTERESTED",
  INTERESTED: "INTERESTED",
  CONVERTED: "CONVERTED",
  COMPLETED: "COMPLETED",
  ESCALATED: "ESCALATED",
  UNREACHABLE: "UNREACHABLE",
  RETURNED_TO_POOL: "RETURNED_TO_POOL",
  DUPLICATE: "DUPLICATE",
} as const;
export type LeadWorkflowStatus = (typeof LeadWorkflowStatus)[keyof typeof LeadWorkflowStatus];

export const BusinessOutcome = {
  NONE: "NONE",
  INTERESTED: "INTERESTED",
  NOT_INTERESTED: "NOT_INTERESTED",
  CONVERTED: "CONVERTED",
  CALLBACK: "CALLBACK",
  LOST: "LOST",
} as const;
export type BusinessOutcome = (typeof BusinessOutcome)[keyof typeof BusinessOutcome];

export const TaskCompletionStatus = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;
export type TaskCompletionStatus = (typeof TaskCompletionStatus)[keyof typeof TaskCompletionStatus];

export const AssignmentStatus = {
  UNASSIGNED: "UNASSIGNED",
  RESERVED: "RESERVED",
  ASSIGNED: "ASSIGNED",
  RETURNED: "RETURNED",
  EXPIRED: "EXPIRED",
} as const;
export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

export const CallDirection = {
  INBOUND: "INBOUND",
  OUTBOUND: "OUTBOUND",
} as const;
export type CallDirection = (typeof CallDirection)[keyof typeof CallDirection];

/** Normalized internal call status. Provider-specific strings map into this via VoipStatusMapping. */
export const CallStatus = {
  RINGING: "RINGING",
  ANSWERED: "ANSWERED",
  CONNECTED: "CONNECTED",
  BUSY: "BUSY",
  NO_ANSWER: "NO_ANSWER",
  ABANDONED: "ABANDONED",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
} as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];

export const DistributionStrategy = {
  FIFO: "FIFO",
  OLDEST_FIRST: "OLDEST_FIRST",
  HIGHEST_PRIORITY: "HIGHEST_PRIORITY",
  ROUND_ROBIN: "ROUND_ROBIN",
  WEIGHTED: "WEIGHTED",
  PARTNER_PRIORITY: "PARTNER_PRIORITY",
  TASK_PRIORITY: "TASK_PRIORITY",
  REGION_MATCH: "REGION_MATCH",
  CATEGORY_MATCH: "CATEGORY_MATCH",
  MANUAL: "MANUAL",
} as const;
export type DistributionStrategy = (typeof DistributionStrategy)[keyof typeof DistributionStrategy];

export const StatusChangeSource = {
  AGENT: "AGENT",
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
  VOIP: "VOIP",
} as const;
export type StatusChangeSource = (typeof StatusChangeSource)[keyof typeof StatusChangeSource];

export const BreakRecordStatus = {
  ACTIVE: "ACTIVE",
  ENDED: "ENDED",
  INTERRUPTED: "INTERRUPTED",
} as const;
export type BreakRecordStatus = (typeof BreakRecordStatus)[keyof typeof BreakRecordStatus];

export const ImportBatchStatus = {
  PENDING: "PENDING",
  PREVIEWING: "PREVIEWING",
  VALIDATING: "VALIDATING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type ImportBatchStatus = (typeof ImportBatchStatus)[keyof typeof ImportBatchStatus];

export const DuplicateHandling = {
  SKIP: "SKIP",
  IMPORT: "IMPORT",
  MARK_FOR_REVIEW: "MARK_FOR_REVIEW",
} as const;
export type DuplicateHandling = (typeof DuplicateHandling)[keyof typeof DuplicateHandling];

export const AssignmentSource = {
  AUTO_DISTRIBUTION: "AUTO_DISTRIBUTION",
  MANUAL: "MANUAL",
  REASSIGNMENT: "REASSIGNMENT",
} as const;
export type AssignmentSource = (typeof AssignmentSource)[keyof typeof AssignmentSource];

export const AUDIT_ACTIONS = [
  "LOGIN",
  "LOGOUT",
  "LOGIN_FAILED",
  "USER_CREATE",
  "USER_UPDATE",
  "USER_DELETE",
  "USER_PASSWORD_RESET",
  "PARTNER_CREATE",
  "PARTNER_UPDATE",
  "TASK_CREATE",
  "TASK_UPDATE",
  "AGENT_TASK_PERMISSION_UPDATE",
  "LEAD_IMPORT_UPLOAD",
  "LEAD_IMPORT_COMMIT",
  "LEAD_IMPORT_CANCEL",
  "LEAD_ASSIGNED",
  "LEAD_REASSIGNED",
  "LEAD_RETURNED_TO_POOL",
  "LEAD_STATUS_UPDATE",
  "BREAK_START",
  "BREAK_END",
  "BREAK_OVERRIDE",
  "BREAK_CORRECTION",
  "SESSION_START",
  "SESSION_END",
  "SESSION_CORRECTION",
  "VOIP_SETTINGS_UPDATE",
  "DISTRIBUTION_RULE_UPDATE",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
