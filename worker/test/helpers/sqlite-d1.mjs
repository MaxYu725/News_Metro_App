import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const program = `import sqlite3,json,sys
p=json.load(sys.stdin)
c=sqlite3.connect(p['path']);c.row_factory=sqlite3.Row
out=[]
try:
 c.execute('BEGIN IMMEDIATE')
 for s in p['statements']:
  before=c.total_changes
  if 'script' in s:
   c.executescript(s['script']);out.append({'results':[],'meta':{'changes':0}})
  else:
   cur=c.execute(s['sql'],s.get('params',[]))
   rows=[dict(r) for r in cur.fetchall()] if cur.description else []
   out.append({'results':rows,'success':True,'meta':{'changes':c.total_changes-before}})
 c.commit()
 print(json.dumps(out))
except Exception as e:
 c.rollback();print(str(e),file=sys.stderr);sys.exit(1)
`;
export function sqliteD1() {
  const dir = mkdtempSync(join(tmpdir(), "topic-d1-")),
    path = join(dir, "test.sqlite");
  const run = (statements) => {
    const r = spawnSync("python3", ["-c", program], {
      input: JSON.stringify({ path, statements }),
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout);
  };
  const db = {
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) {
          return { ...this, params };
        },
        async all() {
          return run([this])[0];
        },
        async run() {
          return run([this])[0];
        },
        async first() {
          return run([this])[0].results[0] || null;
        },
      };
      return statement;
    },
    async batch(statements) {
      return run(statements);
    },
    withSession() {
      return this;
    },
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
  run([
    {
      script: readFileSync(
        new URL(
          "../../migrations/0000_production_baseline.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    },
    {
      script: readFileSync(
        new URL("../../migrations/0001_search_fts.sql", import.meta.url),
        "utf8",
      ),
    },
    {
      script: readFileSync(
        new URL("../../migrations/0003_topic_ai.sql", import.meta.url),
        "utf8",
      ),
    },
  ]);
  return db;
}
export async function seedArticles(db, count = 4, q = "蔡天鳳案") {
  for (let i = 1; i <= count; i++)
    await db
      .prepare(
        "INSERT INTO articles(id,title,link,pubDate,description,category,source) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        String(i),
        `${q}｜法庭審訊被告證供爭議 ${i}`,
        `https://hk01.com/sns/article/${i}`,
        new Date(Date.now() - i * 3600000).toISOString(),
        "警方調查發現重要資料，控方指出案中被告涉及爭議，辯方反對指控，法庭仍未裁定。".repeat(
          5,
        ),
        "local",
        "香港01",
      )
      .run();
}
