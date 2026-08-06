export interface SyncProgress { label: string; current?: number; total?: number }
export type ProgressFn = (p: SyncProgress) => void;
