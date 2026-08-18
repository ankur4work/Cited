import IORedis from "ioredis";
async function main() {
  const r = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  const keys = await r.keys("bull:*:*");
  const qs = [...new Set(keys.map(k => k.split(":")[1]))];
  for (const q of qs) {
    const w = await r.llen(`bull:${q}:wait`), a = await r.llen(`bull:${q}:active`);
    const f = await r.zcard(`bull:${q}:failed`), c = await r.zcard(`bull:${q}:completed`);
    if (w || a || f || c) console.log(`${q}: waiting=${w} active=${a} completed=${c} failed=${f}`);
    if (f) {
      for (const id of await r.zrange(`bull:${q}:failed`, 0, 3)) {
        const j = await r.hgetall(`bull:${q}:${id}`);
        console.log(`   FAILED ${id} name=${j.name} reason=${(j.failedReason ?? "").slice(0, 200)}`);
      }
    }
  }
  await r.quit();
}
main().catch(e => { console.error("ERR", e.message); process.exit(1); });
