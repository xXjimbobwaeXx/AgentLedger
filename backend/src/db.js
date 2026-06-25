import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

pool.on("error", (err) => console.error("pg pool error:", err.message));