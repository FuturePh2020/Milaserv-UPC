import type { UserRef } from './ticket-types';

export type KbStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type ProgressStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface KbContentRow {
  id: string;
  rootId: string;
  version: number;
  kind: 'SOP' | 'ADDED_SOP' | 'DAILY_NOTE' | 'VIDEO' | 'PDF' | 'WORD' | 'FLOW_CHART';
  titleAr: string;
  titleEn: string;
  summaryAr: string | null;
  summaryEn: string | null;
  body: string | null;
  videoUrl: string | null;
  status: KbStatus;
  publishAt: string | null;
  expiryAt: string | null;
  isPublic: boolean;
  owner: UserRef;
  updatedAt: string;
  versions?: { id: string; version: number; status: KbStatus; publishAt: string | null }[];
  attachments?: { id: string; fileName: string; sizeBytes: number }[];
}

export interface CourseProgressSummary {
  status: ProgressStatus;
  progressPct: number;
  watchTimeSeconds: number;
  lastActivityAt: string | null;
}

export interface CourseRow {
  id: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  status: KbStatus;
  dueAt: string | null;
  courseAdmin: UserRef;
  lessonCount?: number;
  myProgress?: CourseProgressSummary;
}

export interface CourseDetail extends CourseRow {
  lessons: {
    id: string;
    order: number;
    titleAr: string;
    titleEn: string;
    videoUrl: string | null;
    durationSeconds: number | null;
    content: {
      id: string;
      kind: string;
      titleAr: string;
      titleEn: string;
      videoUrl: string | null;
    } | null;
    myProgress: {
      positionSeconds: number;
      watchTimeSeconds: number;
      completedAt: string | null;
    } | null;
  }[];
  assignments?: {
    id: string;
    team: { id: string; nameAr: string; nameEn: string } | null;
    user: UserRef | null;
    dueAt: string | null;
  }[];
  myProgress: CourseProgressSummary;
}

export interface TraineeProgressRow {
  user: UserRef & { lastSignInAt: string | null };
  status: ProgressStatus;
  progressPct: number;
  watchTimeSeconds: number;
  lastActivityAt: string | null;
}
