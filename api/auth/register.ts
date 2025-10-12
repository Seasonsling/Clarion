import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';

// A utility function to generate a color from a string
function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests are allowed' });
  }

  try {
    // This is an idempotent action. It creates the table only if it doesn't exist.
    // In a larger application, this would be part of a separate migration script.
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

    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }
    if (username.length < 3 || password.length < 4) {
      return res.status(400).json({ message: "Username must be at least 3 characters, and password at least 4 characters." });
    }

    // Check if user already exists
    const { rows: existingUsers } = await sql`SELECT * FROM users WHERE username = ${username};`;
    if (existingUsers.length > 0) {
      return res.status(409).json({ message: 'Username already taken' });
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 10);
    const displayName = username;
    const color = stringToColor(username);

    // Insert new user into the database
    await sql`
      INSERT INTO users (username, password_hash, display_name, color)
      VALUES (${username}, ${passwordHash}, ${displayName}, ${color});
    `;

    return res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}
