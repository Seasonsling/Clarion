import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '@vercel/postgres';
import { getUserIdFromRequest } from '../_lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Only GET requests are allowed' });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const { rows } = await sql`
      SELECT id, username, display_name, avatar_url, color
      FROM users;
    `;
    
    // Transform data to match client-side UserProfile structure
    const users = rows.map(user => ({
      id: user.id.toString(),
      username: user.username,
      profile: {
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          color: user.color,
      }
    }));

    return res.status(200).json(users);
  } catch (error) {
    console.error('Failed to fetch users:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}
