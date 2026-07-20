import { z } from "zod";
import { UserRole, DuplicateHandling, DistributionStrategy } from "./enums";

export const loginSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const phoneSchema = z
  .string()
  .trim()
  .min(6, "Phone number is too short")
  .max(20, "Phone number is too long")
  .regex(/^[+0-9][0-9\s-]*$/, "Phone number contains invalid characters");

export const createUserSchema = z.object({
  username: z.string().min(3).max(64),
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().min(8).max(128),
  fullName: z.string().min(2).max(120),
  role: z.enum([UserRole.ADMIN, UserRole.AGENT]),
  team: z.string().max(80).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema
  .partial({ password: true, username: true, role: true, fullName: true })
  .extend({
    isActive: z.boolean().optional(),
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const createPartnerSchema = z.object({
  name: z.string().min(2).max(160),
  code: z.string().min(2).max(40),
  partnerType: z.string().max(60).optional(),
  insuranceEnabled: z.boolean().default(false),
  cashEnabled: z.boolean().default(false),
  categoryIds: z.array(z.string().uuid()).default([]),
  contactPerson: z.string().max(160).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
  defaultTaskId: z.string().uuid().optional(),
  priority: z.number().int().min(0).max(100).default(0),
  customFieldDefs: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        type: z.enum(["text", "number", "date", "boolean", "select"]),
        required: z.boolean().default(false),
        options: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  requiredImportColumns: z.array(z.string()).default([]),
});
export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;

export const createTaskSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().min(2).max(40),
  description: z.string().max(2000).optional(),
  partnerIds: z.array(z.string().uuid()).default([]),
  categoryIds: z.array(z.string().uuid()).default([]),
  requiredQuantity: z.number().int().min(0).default(0),
  dailyTarget: z.number().int().min(0).default(0),
  priority: z.number().int().min(0).max(100).default(0),
  maxActiveAgents: z.number().int().min(0).default(0),
  maxConcurrentBreaks: z.number().int().min(0).default(3),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const columnMappingSchema = z.object({
  partnerId: z.string().uuid(),
  mapping: z.record(z.string(), z.string()),
});
export type ColumnMappingInput = z.infer<typeof columnMappingSchema>;

export const commitImportSchema = z.object({
  batchId: z.string().uuid(),
  duplicateHandling: z.enum([
    DuplicateHandling.SKIP,
    DuplicateHandling.IMPORT,
    DuplicateHandling.MARK_FOR_REVIEW,
  ]),
});
export type CommitImportInput = z.infer<typeof commitImportSchema>;

export const updateLeadOutcomeSchema = z.object({
  leadId: z.string().uuid(),
  workflowStatus: z.string(),
  businessOutcome: z.string().optional(),
  notes: z.string().max(2000).optional(),
  callbackAt: z.string().datetime().optional(),
});
export type UpdateLeadOutcomeInput = z.infer<typeof updateLeadOutcomeSchema>;

export const distributionRuleSchema = z.object({
  strategy: z.enum([
    DistributionStrategy.FIFO,
    DistributionStrategy.OLDEST_FIRST,
    DistributionStrategy.HIGHEST_PRIORITY,
    DistributionStrategy.ROUND_ROBIN,
    DistributionStrategy.WEIGHTED,
    DistributionStrategy.PARTNER_PRIORITY,
    DistributionStrategy.TASK_PRIORITY,
    DistributionStrategy.REGION_MATCH,
    DistributionStrategy.CATEGORY_MATCH,
    DistributionStrategy.MANUAL,
  ]),
  maxActiveLeadsPerAgent: z.number().int().min(1).default(1),
  allowNextBeforeCompletion: z.boolean().default(false),
  reservationTimeoutMinutes: z.number().int().min(1).default(30),
  autoReturnUntouched: z.boolean().default(true),
  maxLeadsPerHour: z.number().int().min(0).default(0),
});
export type DistributionRuleInput = z.infer<typeof distributionRuleSchema>;

export const startBreakSchema = z.object({
  breakTypeId: z.string().uuid(),
});
export type StartBreakInput = z.infer<typeof startBreakSchema>;
