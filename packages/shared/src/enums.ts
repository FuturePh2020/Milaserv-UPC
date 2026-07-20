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
  "CALL_OUTCOME_RECORDED",
  "ORDER_CREATE",
  "ORDER_UPDATE",
  "ORDER_ITEM_UPDATE",
  "ORDER_STATUS_UPDATE",
  "ORDER_NOTE_ADDED",
  "ORDER_EXPORT",
  "RETENTION_CUSTOMER_UPDATE",
  "RETENTION_EXPORT",
  "PRODUCT_CREATE",
  "PRODUCT_UPDATE",
  "PRODUCT_STATUS_UPDATE",
  "PRODUCT_IMPORT",
  "PRODUCT_EXPORT",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// ─────────────────────────────────────────────────────────────
// Phase 2: call outcomes, orders, retention, products
// ─────────────────────────────────────────────────────────────

export const CallResultType = {
  NO_ANSWER: "NO_ANSWER",
  ANSWERED: "ANSWERED",
} as const;
export type CallResultType = (typeof CallResultType)[keyof typeof CallResultType];

export const AnsweredOutcomeType = {
  ORDER_CREATED: "ORDER_CREATED",
  NOT_INTERESTED: "NOT_INTERESTED",
  WRONG_TIME: "WRONG_TIME",
  RESCHEDULE_CALL: "RESCHEDULE_CALL",
  ALREADY_DISPENSED: "ALREADY_DISPENSED",
  INTERESTED_FOLLOWUP: "INTERESTED_FOLLOWUP",
  WRONG_LEAD: "WRONG_LEAD",
} as const;
export type AnsweredOutcomeType = (typeof AnsweredOutcomeType)[keyof typeof AnsweredOutcomeType];

export const ContactTimingType = {
  EXACT_TIME: "EXACT_TIME",
  MORNING: "MORNING",
  EVENING: "EVENING",
} as const;
export type ContactTimingType = (typeof ContactTimingType)[keyof typeof ContactTimingType];

export const FollowUpStatus = {
  PENDING: "PENDING",
  DONE: "DONE",
  CANCELLED: "CANCELLED",
} as const;
export type FollowUpStatus = (typeof FollowUpStatus)[keyof typeof FollowUpStatus];

export const FollowUpPriority = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
} as const;
export type FollowUpPriority = (typeof FollowUpPriority)[keyof typeof FollowUpPriority];

export const OrderType = {
  INSURANCE: "INSURANCE",
  CASH: "CASH",
} as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];

/** Display label for WHATSAPP must render exactly as "WhatsApp" in the UI. */
export const OrderSource = {
  INBOUND_CALL: "INBOUND_CALL",
  LEADS: "LEADS",
  WHATSAPP: "WHATSAPP",
  PARTNER: "PARTNER",
  RETENTION_CUSTOMER: "RETENTION_CUSTOMER",
} as const;
export type OrderSource = (typeof OrderSource)[keyof typeof OrderSource];

export const OrderSourceLabels: Record<OrderSource, string> = {
  INBOUND_CALL: "Inbound Call",
  LEADS: "Leads",
  WHATSAPP: "WhatsApp",
  PARTNER: "Partner",
  RETENTION_CUSTOMER: "Retention Customer",
};

export const OrderStatus = {
  PENDING: "PENDING",
  HOLDED: "HOLDED",
  ON_THE_WAY: "ON_THE_WAY",
  PICKED_UP: "PICKED_UP",
  COMPLETED: "COMPLETED",
  CLOSED: "CLOSED",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Statuses whose Expected Order Value counts toward Pending Completion Value. */
export const PENDING_COMPLETION_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.HOLDED,
  OrderStatus.ON_THE_WAY,
  OrderStatus.PICKED_UP,
];

export const RefillMode = {
  NUMBER_OF_DAYS: "NUMBER_OF_DAYS",
  EXACT_DATE: "EXACT_DATE",
} as const;
export type RefillMode = (typeof RefillMode)[keyof typeof RefillMode];

export const ProductImportBehavior = {
  CREATE_ONLY: "CREATE_ONLY",
  UPDATE_BY_CODE: "UPDATE_BY_CODE",
  UPDATE_BY_BARCODE: "UPDATE_BY_BARCODE",
  CREATE_AND_UPDATE: "CREATE_AND_UPDATE",
  SKIP_DUPLICATES: "SKIP_DUPLICATES",
  REJECT_DUPLICATES: "REJECT_DUPLICATES",
} as const;
export type ProductImportBehavior = (typeof ProductImportBehavior)[keyof typeof ProductImportBehavior];

export const EventSource = {
  AGENT: "AGENT",
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
  VOIP: "VOIP",
  IMPORT: "IMPORT",
} as const;
export type EventSource = (typeof EventSource)[keyof typeof EventSource];

/** Granular permission keys (spec section 21/38). */
export const Permission = {
  ORDERS_CREATE: "orders.create",
  ORDERS_VIEW_OWN: "orders.viewOwn",
  ORDERS_VIEW_TEAM: "orders.viewTeam",
  ORDERS_VIEW_ALL: "orders.viewAll",
  ORDERS_UPDATE_OWN: "orders.updateOwn",
  ORDERS_UPDATE_TEAM: "orders.updateTeam",
  ORDERS_UPDATE_ALL: "orders.updateAll",
  ORDERS_COMPLETE: "orders.complete",
  ORDERS_CLOSE: "orders.close",
  ORDERS_REASSIGN: "orders.reassign",
  ORDERS_EXPORT: "orders.export",
  RETENTION_VIEW: "retention.view",
  RETENTION_UPDATE: "retention.update",
  RETENTION_EXPORT: "retention.export",
  TARGETS_MANAGE: "targets.manage",
  PRODUCTS_VIEW: "products.view",
  PRODUCTS_CREATE: "products.create",
  PRODUCTS_UPDATE: "products.update",
  PRODUCTS_ACTIVATE: "products.activate",
  PRODUCTS_DEACTIVATE: "products.deactivate",
  PRODUCTS_ARCHIVE: "products.archive",
  PRODUCTS_RESTORE: "products.restore",
  PRODUCTS_IMPORT: "products.import",
  PRODUCTS_EXPORT: "products.export",
  PRODUCTS_MANAGE_PARTNER_AVAILABILITY: "products.managePartnerAvailability",
  PRODUCTS_MANAGE_PRICES: "products.managePrices",
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

/** Default permission set granted to CRM Agents (spec section 21/38); Admins always pass every check. */
export const DEFAULT_AGENT_PERMISSIONS: Permission[] = [
  Permission.ORDERS_CREATE,
  Permission.ORDERS_VIEW_OWN,
  Permission.ORDERS_UPDATE_OWN,
  Permission.RETENTION_VIEW,
  Permission.PRODUCTS_VIEW,
];
