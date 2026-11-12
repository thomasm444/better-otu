import fs from "fs";
import path from "path";
import { Client } from "pg";

async function apply() {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20261112000000_campus_map_schema.sql"),
    "utf-8"
  );

  const client = new Client({
    host: "aws-0-us-east-1.pooler.supabase.com",
    port: 6543,
    user: "postgres.ayxxunfcieoujoolqdbl",
    password: process.env.SUPABASE_DATABASE_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });

  console.log("Connecting to Supabase Postgres...");
  await client.connect();
  console.log("Connected. Applying 20261112000000_campus_map_schema.sql...");
  await client.query(sql);
  console.log("Migration applied successfully!");
  await client.end();
}

apply().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
