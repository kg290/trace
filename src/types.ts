export const VERSION = '0.3.0';
export const SCHEMA = 1;
export type State = 'idle' | 'recording' | 'finalizing' | 'complete' | 'incomplete';
export interface Settings {
  values: boolean;
  messages: boolean;
  screenshots: boolean;
}
export const DEFAULT_LIMITS = { events: 2000, bytes: 2_000_000, durationMs: 300_000, screenshots: 3 };
export type Limits = typeof DEFAULT_LIMITS;
export type LocatorSpec = { by: 'label' | 'role' | 'testId' | 'id'; value: string; role?: string };
export interface EvidenceEvent {
  id: string; seq: number; session: string; at: string; elapsedMs: number;
  kind: string; document?: string; browserSeq?: number; browserMs?: number;
  data: Record<string, any>;
}
export interface Action {
  event: string; action: 'click' | 'fill' | 'check' | 'select' | 'press' | 'reload';
  locator?: LocatorSpec; value?: string | boolean | string[]; parameter?: string;
  awaitResponse?: { method: string; url: string };
  waitFor?: LocatorSpec;
}
export interface Recipe { schema: 1; status: 'ready' | 'needs inputs/authentication' | 'unsupported steps' | 'unavailable'; actions: Action[]; reasons: string[] }
export interface Manifest {
  schema: number; tool: string; version: string; id: string;
  origin: string; startUrl: string; project: string; projectIdentity: string;
  startedAt: string; stoppedAt: string; durationMs: number;
  settings: Settings; limits: Limits; completeness: 'complete within supported scope' | 'incomplete';
  omissions: string[]; expected: string; environment: Record<string, string>;
  counts: { events: number; bytes: number; dropped: number };
  measurements: { cpuMs: number; nodeRssBytes: number; observerMs: number };
  serverEvidence: string; attachments: string[];
}
export interface Incident { manifest: Manifest; events: EvidenceEvent[]; recipe: Recipe; brief: string }
export interface Oracle {
  schema: 1; origin: string; prerequisites: string;
  checks: Array<
    { kind: 'value' | 'text'; phase: 'after actions' | 'after reload'; locator: LocatorSpec; equals: string } |
    { kind: 'http'; method: 'GET' | 'POST' | 'PATCH' | 'PUT'; path: string; body?: Record<string, unknown>; status: number; authentication: 'session' | 'none' }
  >;
}
