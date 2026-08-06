import type { AppState, CategoryId, DataMode, Density } from '../types.js';

const listeners = new Set<() => void>();

const state: AppState = {
  activeCategory: 'latest',
  savedIds: new Set(['tech-device-demo']),
  readIds: new Set(),
  searchQuery: '',
  fontScale: 1,
  reducedMotion: false,
  density: 'comfortable',
  dataMode: 'ready',
  online: navigator.onLine,
};

function emit(): void {
  for (const listener of listeners) listener();
}

export const store = {
  getState(): AppState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setCategory(category: CategoryId): void {
    state.activeCategory = category;
    emit();
  },
  setSearchQuery(query: string): void {
    state.searchQuery = query;
    emit();
  },
  toggleSaved(id: string): void {
    if (state.savedIds.has(id)) state.savedIds.delete(id);
    else state.savedIds.add(id);
    emit();
  },
  markRead(id: string): void {
    if (!state.readIds.has(id)) {
      state.readIds.add(id);
      emit();
    }
  },
  setFontScale(scale: number): void {
    state.fontScale = Math.min(1.25, Math.max(0.9, scale));
    emit();
  },
  setReducedMotion(value: boolean): void {
    state.reducedMotion = value;
    emit();
  },
  setDensity(value: Density): void {
    state.density = value;
    emit();
  },
  setDataMode(value: DataMode): void {
    state.dataMode = value;
    emit();
  },
  setOnline(value: boolean): void {
    state.online = value;
    emit();
  },
};
