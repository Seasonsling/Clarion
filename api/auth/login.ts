import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests are allowed' });
  }

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    console.error('JWT_SECRET environment variable is not set.');
    // Do not expose internal configuration details to the client
    return res.status(500).json({ message: 'Server configuration error.' });
  }

  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    // Query the user from the database
    const { rows } = await sql`SELECT id, username, password_hash, display_name, avatar_url, color FROM users WHERE username = ${username};`;
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Compare the provided password with the stored hash
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // User is authenticated, generate a JWT
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        profile: {
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          color: user.color,
        },
      },
      JWT_SECRET,
      { expiresIn: '7d' } // Token expires in 7 days
    );

    return res.status(200).json({ token });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}