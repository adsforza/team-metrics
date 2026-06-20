export const STATUS_CATEGORIES = {
  todo:      ['To Do', 'Tareas por hacer', 'Backlog', 'Por Hacer'],
  waiting:   ['Ready for Development', 'Prioritized', 'Committed', 'Prioritization', 'Ready for deploy'],
  active:    ['In Progress', 'IN PROGRESS', 'EN CURSO', 'In development'],
  blocked:   ['Blocked'],
  done:      ['Done', 'Finalizada'],
  cancelled: ['Cancelled', 'Cancelado'],
} as const;

export type StatusCategory = keyof typeof STATUS_CATEGORIES | 'unknown';

export function categorize(status: string): StatusCategory {
  for (const [cat, list] of Object.entries(STATUS_CATEGORIES)) {
    if ((list as readonly string[]).includes(status)) return cat as StatusCategory;
  }
  return 'unknown';
}

export const ACTIVE_STATUSES: readonly string[] = STATUS_CATEGORIES.active;
export const DONE_STATUSES: readonly string[] = STATUS_CATEGORIES.done;
