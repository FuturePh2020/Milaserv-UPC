/**
 * Notification Engine foundation (blueprint §8): In-App now; Email/SMS (and
 * later WhatsApp) implement the same interface and are toggled per-channel
 * from Settings without touching callers.
 */
export interface NotificationMessage {
  userId: string;
  type: string;
  titleAr: string;
  titleEn: string;
  bodyAr?: string;
  bodyEn?: string;
  /** Structured payload for deep-linking (entityType/entityId, …). */
  payload?: Record<string, unknown>;
}

export interface NotificationChannel {
  readonly name: string;
  deliver(message: NotificationMessage): Promise<void>;
}
