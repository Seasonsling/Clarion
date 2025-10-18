import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '@vercel/postgres';
import { getUserIdFromRequest } from '../_lib/auth';
import { ensureSchema } from '../_lib/db';

async function handlePut(req: VercelRequest, res: VercelResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const projectId = req.query.id as string;
  const projectData = req.body;

  if (!projectId || !projectData) {
    return res.status(400).json({ message: 'Project ID and data are required' });
  }

  try {
    await ensureSchema(); // Ensure DB tables exist

    // Authorization check: User must be an Admin or Editor
    const { rows: memberRows } = await sql`
        SELECT role FROM project_members 
        WHERE project_id = ${projectId} AND user_id = ${userId};
    `;
    if (memberRows.length === 0 || !['Admin', 'Editor'].includes(memberRows[0].role)) {
        return res.status(403).json({ message: 'Permission denied' });
    }

    await sql.query('BEGIN');

    // Update the main project data blob
    await sql`
        UPDATE projects
        SET project_data = ${JSON.stringify(projectData)}, updated_at = NOW()
        WHERE id = ${projectId};
    `;

    // Sync the members table with the members from the project data
    await sql`DELETE FROM project_members WHERE project_id = ${projectId};`;
    for (const member of projectData.members) {
        await sql`
            INSERT INTO project_members (project_id, user_id, role)
            VALUES (${projectId}, ${member.userId}, ${member.role});
        `;
    }

    await sql.query('COMMIT');
    return res.status(200).json(projectData);

  } catch (error) {
    await sql.query('ROLLBACK');
    console.error('Failed to update project:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

async function handleDelete(req: VercelRequest, res: VercelResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const projectId = req.query.id as string;
  if (!projectId) {
    return res.status(400).json({ message: 'Project ID is required' });
  }

  try {
    await ensureSchema(); // Ensure DB tables exist

    // Authorization check: User must be the owner
    const { rows } = await sql`SELECT owner_id FROM projects WHERE id = ${projectId};`;
    if (rows.length === 0 || rows[0].owner_id !== userId) {
        return res.status(403).json({ message: 'Only the project owner can delete this project.' });
    }

    // ON DELETE CASCADE on the project_members table handles member cleanup
    await sql`DELETE FROM projects WHERE id = ${projectId};`;

    return res.status(204).end();
  } catch (error) {
    console.error('Failed to delete project:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  switch (req.method) {
    case 'PUT':
      return handlePut(req, res);
    case 'DELETE':
      return handleDelete(req, res);
    default:
      res.setHeader('Allow', ['PUT', 'DELETE']);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
