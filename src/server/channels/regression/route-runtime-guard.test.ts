import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const WEBHOOK_ROUTES = [
  "src/app/api/channels/slack/webhook/route.ts",
  "src/app/api/channels/telegram/webhook/route.ts",
  "src/app/api/channels/whatsapp/webhook/route.ts",
  "src/app/api/channels/discord/webhook/route.ts",
] as const;

test("channel webhook routes do not export runtime=nodejs", async () => {
  for (const relativePath of WEBHOOK_ROUTES) {
    const absolutePath = path.join(process.cwd(), relativePath);
    if (!existsSync(absolutePath)) continue;
    const source = await readFile(absolutePath, "utf8");
    assert.equal(
      /export\s+const\s+runtime\s*=\s*["']nodejs["']/.test(source),
      false,
      `${relativePath} must not export runtime=nodejs with Next 16 cacheComponents`,
    );
  }
});

