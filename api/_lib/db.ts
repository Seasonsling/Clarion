import { sql } from '@vercel/postgres';

// Using a simple flag to avoid re-running schema checks within a single invocation.
// In a serverless environment, this will be reset for each new request.
let schemaInitialized = false;

export async function ensureSchema() {
  if (schemaInitialized) {
    return;
  }
  
  try {
    // This is idempotent and ensures all tables exist.
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        color VARCHAR(7) NOT NULL,
        avatar_url TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(255) PRIMARY KEY,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_data JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS project_members (
        project_id VARCHAR(255) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL,
        PRIMARY KEY (project_id, user_id)
      );
    `;
    
    schemaInitialized = true;
  } catch (error) {
    console.error("Error ensuring database schema:", error);
    // Re-throw the error to be caught by the calling handler
    throw new Error("Database schema initialization failed.");
  }
}
