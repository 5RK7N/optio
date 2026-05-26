import "dotenv/config";
import { db } from "../db/client.js";
import { connectionProviders } from "../db/schema.js";
import { isNull, eq, and, sql } from "drizzle-orm";

async function main() {
  const slugs = [
    "notion",
    "gitlab-enhanced",
    "github-enhanced",
    "slack",
    "linear",
    "postgres",
    "sentry",
    "filesystem",
    "custom-mcp",
    "custom-http",
  ];

  for (const slug of slugs) {
    const rows = await db
      .select()
      .from(connectionProviders)
      .where(and(eq(connectionProviders.slug, slug), isNull(connectionProviders.workspaceId)))
      .orderBy(sql`${connectionProviders.createdAt} ASC`);

    if (rows.length > 1) {
      console.log(
        `Found ${rows.length} built-in providers for ${slug}. Deleting ${rows.length - 1}...`,
      );
      const toDelete = rows.slice(1).map((r) => r.id);

      for (const id of toDelete) {
        await db.delete(connectionProviders).where(eq(connectionProviders.id, id));
      }
    }
  }
  console.log("Cleanup complete");
}

main()
  .catch(console.error)
  .then(() => process.exit(0));
