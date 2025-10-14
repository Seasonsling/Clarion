import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '@vercel/postgres';
import { getUserIdFromRequest } from '../_lib/auth';

async function handleGet(req: VercelRequest, res: VercelResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const { rows } = await sql`
      SELECT p.project_data FROM projects p
      JOIN project_members pm ON p.id = pm.project_id
      WHERE pm.user_id = ${userId};
    `;
    const projects = rows.map(row => row.project_data);
    return res.status(200).json(projects);
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    const projectData = req.body;

    if (!projectData || !projectData.id || !projectData.项目名称 || !projectData.ownerId) {
        return res.status(400).json({ message: 'Invalid project data provided.' });
    }
    
    // Ensure the creator is the owner
    if (parseInt(projectData.ownerId, 10) !== userId) {
        return res.status(403).json({ message: 'Owner ID does not match authenticated user.'});
    }

    try {
        await sql.query('BEGIN');

        await sql`
            INSERT INTO projects (id, owner_id, project_data, created_at, updated_at)
            VALUES (${projectData.id}, ${userId}, ${JSON.stringify(projectData)}, NOW(), NOW());
        `;

        for (const member of projectData.members) {
            await sql`
                INSERT INTO project_members (project_id, user_id, role)
                VALUES (${projectData.id}, ${member.userId}, ${member.role});
            `;
        }

        await sql.query('COMMIT');
        return res.status(201).json(projectData);
    } catch (error) {
        await sql.query('ROLLBACK');
        console.error('Failed to create project:', error);
        // Check for unique constraint violation
        if (typeof error === 'object' && error && 'code' in error && (error as { code: unknown }).code === '23505') {
            return res.status(409).json({ message: 'A project with this ID already exists.' });
        }
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'POST':
      return handlePost(req, res);
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}