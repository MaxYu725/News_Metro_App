export const ARCHIVE_BINDING_NAMES = Object.freeze(
  Array.from({ length: 9 }, (_, index) => `ARCHIVE_${String(index + 1).padStart(2, '0')}`),
);

function readableDatabase(value) {
  return value && typeof value.prepare === 'function';
}

function sessionDatabase(db) {
  if (!readableDatabase(db)) return null;
  if (typeof db.withSession !== 'function') return db;
  return db.withSession('first-unconstrained');
}

export function archiveDatabases(env, { sessions = true } = {}) {
  const seen = new Set();
  const databases = [];

  for (const binding of ARCHIVE_BINDING_NAMES) {
    const raw = env?.[binding];
    if (!readableDatabase(raw) || seen.has(raw)) continue;
    seen.add(raw);
    databases.push(sessions ? sessionDatabase(raw) : raw);
  }

  return databases.filter(Boolean);
}

export async function sourceCountsAcrossDatabases(databases) {
  const eligible = (databases || []).filter(readableDatabase);
  if (eligible.length === 0) return new Map();

  const batches = await Promise.all(
    eligible.map(db => db.prepare('SELECT source, COUNT(*) AS count FROM articles GROUP BY source').all()),
  );

  const totals = new Map();
  for (const batch of batches) {
    for (const row of batch?.results || []) {
      const source = String(row?.source || '');
      if (!source) continue;
      totals.set(source, (totals.get(source) || 0) + Number(row?.count || 0));
    }
  }
  return totals;
}
