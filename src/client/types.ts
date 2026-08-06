export type CategoryId = 'latest' | 'local' | 'world' | 'finance' | 'tech' | 'entertainment' | 'sports';

export interface Category {
  id: CategoryId;
  label: string;
}

export interface Article {
  id: string;
  category: Exclude<CategoryId, 'latest'>;
  title: string;
  excerpt: string;
  body: string[];
  source: string;
  sourceUrl: string;
  publishedAt: string;
  updatedAt?: string;
  image?: string;
  imageAlt?: string;
  tags: string[];
  breaking?: boolean;
}

export type DataMode = 'ready' | 'loading' | 'empty' | 'error' | 'offline';
export type Density = 'comfortable' | 'compact';

export interface AppState {
  activeCategory: CategoryId;
  savedIds: Set<string>;
  readIds: Set<string>;
  searchQuery: string;
  fontScale: number;
  reducedMotion: boolean;
  density: Density;
  dataMode: DataMode;
  online: boolean;
}

export type Route =
  | { name: 'feed'; category: CategoryId }
  | { name: 'article'; articleId: string }
  | { name: 'search' }
  | { name: 'saved' }
  | { name: 'settings' };
