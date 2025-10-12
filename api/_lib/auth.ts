import type { VercelRequest } from '@vercel/node';
import jwt from 'jsonwebtoken';

interface DecodedToken {
    userId: number;
    // ... other properties from the token payload
}

export function getUserIdFromRequest(req: VercelRequest): number | null {
  const token = req.headers.authorization?.split(' ')[1];
  const JWT_SECRET = process.env.JWT_SECRET;

  if (!token || !JWT_SECRET) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as DecodedToken;
    return decoded.userId;
  } catch (error) {
    console.error("JWT Verification Error:", error);
    return null;
  }
}
