import { TOPIC_LIMITS } from "./topic-ai-policy.js";

// Primary session: cache leases and budget checks must not read stale replicas.
export function topicStore(database) {
  const db = database.withSession
    ? database.withSession("first-primary")
    : database;
  return {
    async read(key) {
      return db
        .prepare("SELECT * FROM topic_ai_cache WHERE cache_key = ?")
        .bind(key)
        .first();
    },
    async claim(key, spec, token, now) {
      const result = await db
        .prepare(
          `INSERT INTO topic_ai_cache
        (cache_key,query,preference,source_filter,lease_token,lease_until,updated_at)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(cache_key) DO UPDATE SET lease_token=excluded.lease_token,
          lease_until=excluded.lease_until,updated_at=excluded.updated_at
        WHERE topic_ai_cache.lease_until <= ?`,
        )
        .bind(
          key,
          spec.query,
          spec.preference,
          spec.sourceIds.join(","),
          token,
          now + TOPIC_LIMITS.lease,
          now,
          now,
        )
        .run();
      return result.meta?.changes === 1;
    },
    async finish(key, token, state, now) {
      const r = await db
        .prepare(
          `UPDATE topic_ai_cache SET analysis_json=?,output_json=?,sources_json=?,members_json=?,
        checked_at=?,generated_at=?,retry_at=?,updated_at=?,lease_token=NULL,lease_until=0
        WHERE cache_key=? AND lease_token=? AND lease_until>?`,
        )
        .bind(
          JSON.stringify(state.analysis),
          state.output ? JSON.stringify(state.output) : null,
          JSON.stringify(state.sources || []),
          JSON.stringify(state.members || []),
          state.checkedAt,
          state.generatedAt || 0,
          state.retryAt || 0,
          now,
          key,
          token,
          now,
        )
        .run();
      return r.meta?.changes === 1;
    },
    async release(key, token, retryAt = 0) {
      const r = await db
        .prepare(
          "UPDATE topic_ai_cache SET lease_token=NULL,lease_until=0,retry_at=? WHERE cache_key=? AND lease_token=?",
        )
        .bind(retryAt, key, token)
        .run();
      return r.meta?.changes === 1;
    },
    async markChecked(key, token, now) {
      await db
        .prepare(
          "UPDATE topic_ai_cache SET checked_at=?,updated_at=? WHERE cache_key=? AND lease_token=?",
        )
        .bind(now, now, key, token)
        .run();
    },
    async reserveBudget(now) {
      const date = new Date(now),
        bucket = date.toISOString().slice(0, 10),
        path = `$."${date.getUTCHours()}"`;
      // One conditional UPSERT reserves both limits atomically, including first call.
      const result = await db
        .prepare(
          `INSERT INTO topic_ai_budget(bucket,calls,hours_json) VALUES(?,1,json_set('{}',?,1))
        ON CONFLICT(bucket) DO UPDATE SET calls=calls+1,
          hours_json=json_set(hours_json,?,COALESCE(json_extract(hours_json,?),0)+1)
        WHERE calls < 40 AND COALESCE(json_extract(hours_json,?),0) < 8
        RETURNING calls`,
        )
        .bind(bucket, path, path, path, path)
        .all();
      return result.results?.length === 1;
    },
    async prune(now) {
      await db.batch([
        db
          .prepare(
            "DELETE FROM topic_ai_cache WHERE updated_at < ? AND lease_until <= ?",
          )
          .bind(now - 30 * 86400000, now),
        db
          .prepare(
            `DELETE FROM topic_ai_cache WHERE cache_key IN (
          SELECT cache_key FROM topic_ai_cache WHERE lease_until <= ? ORDER BY updated_at DESC
          LIMIT -1 OFFSET 500)`,
          )
          .bind(now),
        db
          .prepare("DELETE FROM topic_ai_budget WHERE bucket < ?")
          .bind(new Date(now - 30 * 86400000).toISOString().slice(0, 10)),
      ]);
    },
  };
}
