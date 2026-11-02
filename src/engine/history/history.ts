/**
 * Snapshot-based command history.
 *
 * Every editing command is a pure function `(state) => state`. Because scene
 * state is immutable with structural sharing, storing the before/after
 * snapshots is cheap (unchanged objects are shared by reference) and undo is
 * guaranteed to restore exactly the previous state, including hierarchy
 * order, components and selection.
 */

export interface HistoryEntry<S> {
  label: string;
  before: S;
  after: S;
  /** Optional key used to merge rapid successive edits (e.g. typing a number). */
  mergeKey?: string;
  timestamp: number;
  selectionBefore: string[];
  selectionAfter: string[];
}

export interface HistoryOptions {
  limit?: number;
  mergeWindowMs?: number;
  now?: () => number;
}

export class CommandHistory<S> {
  private undoStack: HistoryEntry<S>[] = [];
  private redoStack: HistoryEntry<S>[] = [];
  private readonly limit: number;
  private readonly mergeWindowMs: number;
  private readonly now: () => number;

  constructor(options: HistoryOptions = {}) {
    this.limit = options.limit ?? 200;
    this.mergeWindowMs = options.mergeWindowMs ?? 800;
    this.now = options.now ?? (() => Date.now());
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  get size(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }

  /** Records a change. Returns false when before === after (nothing changed). */
  record(entry: Omit<HistoryEntry<S>, 'timestamp'>): boolean {
    if (entry.before === entry.after) return false;
    const timestamp = this.now();
    const last = this.undoStack.at(-1);
    if (
      entry.mergeKey &&
      last &&
      last.mergeKey === entry.mergeKey &&
      timestamp - last.timestamp <= this.mergeWindowMs &&
      last.after === entry.before
    ) {
      last.after = entry.after;
      last.timestamp = timestamp;
      last.selectionAfter = entry.selectionAfter;
      this.redoStack = [];
      return true;
    }
    this.undoStack.push({ ...entry, timestamp });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }

  undo(): HistoryEntry<S> | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return entry;
  }

  redo(): HistoryEntry<S> | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return entry;
  }

  /** Prevents the next record() from merging into the previous entry. */
  breakMerge(): void {
    const last = this.undoStack.at(-1);
    if (last) last.mergeKey = undefined;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
