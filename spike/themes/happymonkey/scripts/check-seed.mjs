import fs from "node:fs";
const s = JSON.parse(fs.readFileSync("/app/seed/seed.json", "utf8"));
console.log("name", s.meta?.name);
console.log("collections", (s.collections || []).map((c) => c.slug).join(","));
console.log("content keys", Object.keys(s.content || {}).join(","));
const home = (s.content?.pages || []).find((p) => p.slug === "home");
console.log("home layout blocks", home?.data?.layout?.length ?? 0);
