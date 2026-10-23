import type { Stage } from "./stages.js";
import type { Room, StructureSpec } from "./structure.js";

export type Gps = { lat: number; lon: number };

export type Project = {
  id: string;
  name: string;
  location: string;
  createdAt: string;
  spec: StructureSpec;
  rooms: Room[];
  shareToken: string | null;
  whatsapp?: WhatsApp;
};

// Automatic reports and alerts to managers on WhatsApp (src/whatsapp.ts).
export type WhatsApp = {
  managers: { name: string; phone: string }[]; // phone: digits with country code, e.g. 919876543210
  frequency: "off" | "weekly" | "monthly";
  alerts: boolean;
  lastReport: string | null; // start date of the last period sent, so each report goes once
  sentAlerts: string[]; // alerts already sent and still active
};

export type PhotoAi = { stage: string; confidence: string; materials: string[]; issues: string[]; features?: Partial<Record<import("./ai/schema.js").Feature, boolean>> };

export type Photo = {
  file: string;
  hash: string;
  takenAt: string | null; // from EXIF, when the phone recorded it
  gps: Gps | null;
  flags: string[]; // reasons a person should look; advisory, never proof
  checking: boolean; // AI check still queued or running
  ai: PhotoAi | null;
  aiError: boolean;
  compare?: import("./compare.js").Compare; // against the earlier photo of the same place
};

// One claim by the site manager: these rooms are at this stage, with this evidence.
export type Update = {
  id: number;
  at: string;
  roomIds: string[];
  scopeLabel: string;
  stage: Stage;
  note: string;
  photos: Photo[];
  review: "approved" | "rejected" | null;
  reviewedAt: string | null;
};

export type Issue = {
  id: number;
  at: string;
  roomIds: string[];
  scopeLabel: string;
  title: string;
  note: string;
  severity: "low" | "medium" | "high";
  status: "suggested" | "open" | "resolved" | "dismissed";
  source: "manager" | "ai";
  updateId: number | null;
  photo: string | null;
  resolvedAt: string | null;
};

export type Doc = {
  id: number;
  at: string;
  title: string;
  category: "plans" | "permits" | "contracts" | "reports" | "other";
  file: string; // stored name
  originalName: string;
  size: number;
  type: string;
};

// baselineDays: the number worked out in code from the building and a typical crew; ai: false when the AI did not answer
export type Eta = { etaDays: number; confidence: "low" | "medium" | "high"; reason: string; baselineDays: number; adjusted: boolean; ai: boolean };
// crew assumed for the finish estimate (src/finish.ts typicalCrew)
export type Crew = { workers: number; daysPerWeek: number };
