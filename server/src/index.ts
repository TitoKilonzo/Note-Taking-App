import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from './db.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
app.use(helmet());
const allowedOrigins = new Set((process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map(origin => origin.trim()));
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.add('http://localhost:5173');
  allowedOrigins.add('http://127.0.0.1:5173');
}
app.use(cors({ origin: (origin, callback) => {
  if (!origin || allowedOrigins.has(origin)) return callback(null, true);
  return callback(new Error('Origin is not allowed by CORS'));
} }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));

type AuthRequest = express.Request & { userId?: string };
function authenticate(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const subject = (jwt.verify(token, jwtSecret!) as jwt.JwtPayload).sub;
    if (typeof subject !== 'string') return res.status(401).json({ error: 'Invalid or expired session' });
    req.userId = subject;
    next();
  }
  catch { return res.status(401).json({ error: 'Invalid or expired session' }); }
}
const registerSchema = z.object({ name: z.string().trim().min(2).max(80), email: z.email(), password: z.string().min(10).max(128) });
const noteSchema = z.object({ title: z.string().max(200).optional(), content: z.unknown().optional(), plainText: z.string().max(100000).optional(), categoryId: z.string().nullable().optional(), tagIds: z.array(z.string()).optional(), isFavorite: z.boolean().optional(), isPinned: z.boolean().optional(), status: z.enum(['ACTIVE','ARCHIVED','TRASHED']).optional() });
const categorySchema = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });
const tagSchema = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });

async function validateCategory(userId: string, categoryId: string | null | undefined) {
  if (categoryId && !await prisma.category.findFirst({ where: { id: categoryId, userId } })) {
    throw new Error('CATEGORY_NOT_FOUND');
  }
}
async function validateTags(userId: string, tagIds: string[] | undefined) {
  const uniqueIds = [...new Set(tagIds ?? [])];
  const ownedTags = await prisma.tag.count({ where: { id: { in: uniqueIds }, userId } });
  if (ownedTags !== uniqueIds.length) throw new Error('TAG_NOT_FOUND');
}
async function replaceNoteTags(noteId: string, userId: string, tagIds: string[]) {
  const uniqueIds = [...new Set(tagIds)];
  await prisma.noteTag.deleteMany({ where: { noteId } });
  if (uniqueIds.length) {
    await prisma.noteTag.createMany({ data: uniqueIds.map(tagId => ({ noteId, tagId })) });
  }
}

app.get('/api/health', async (_req,res,next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', service: 'noted-api', database: 'connected' });
  } catch (error) { next(error); }
});
app.post('/api/auth/register', async (req,res,next) => {
  try {
    const data = registerSchema.parse(req.body);
    const email = data.email.toLowerCase();
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ error: 'An account with this email already exists' });
    const user = await prisma.user.create({ data: { name: data.name, email, passwordHash: await bcrypt.hash(data.password, 12) } });
    const token = jwt.sign({ sub: user.id }, jwtSecret!, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) { next(error); }
});
app.post('/api/auth/login', async (req,res,next) => {
  try {
    const data = z.object({ email: z.email(), password: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect' });
    const token = jwt.sign({ sub: user.id }, jwtSecret!, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) { next(error); }
});
app.get('/api/notes', authenticate, async (req: AuthRequest,res,next) => {
  try {
    const status = z.enum(['ACTIVE','ARCHIVED','TRASHED']).catch('ACTIVE').parse(req.query.status);
    const notes = await prisma.note.findMany({ where: { userId: req.userId!, status }, include: { category: true, tags: { include: { tag: true } } }, orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }] });
    res.json({ notes });
  } catch (error) { next(error); }
});
app.post('/api/notes', authenticate, async (req: AuthRequest,res,next) => {
  try {
    const data = noteSchema.parse(req.body);
    await validateCategory(req.userId!, data.categoryId);
    await validateTags(req.userId!, data.tagIds);
    const note = await prisma.note.create({ data: { title: data.title ?? 'Untitled note', content: (data.content ?? {}) as object, plainText: data.plainText ?? '', userId: req.userId!, categoryId: data.categoryId ?? null }, include: { category: true } });
    if (data.tagIds) await replaceNoteTags(note.id, req.userId!, data.tagIds);
    res.status(201).json({ note });
  } catch (error) { next(error); }
});
app.patch('/api/notes/:id', authenticate, async (req: AuthRequest,res,next) => {
  try {
    const data = noteSchema.parse(req.body);
    const noteId = String(req.params.id);
    const owned = await prisma.note.findFirst({ where: { id: noteId, userId: req.userId! } });
    if (!owned) return res.status(404).json({ error: 'Note not found' });
    if (data.categoryId !== undefined) await validateCategory(req.userId!, data.categoryId);
    await validateTags(req.userId!, data.tagIds);
    const { tagIds: _tagIds, content, ...noteData } = data;
    const note = await prisma.note.update({
      where: { id: owned.id },
      data: {
        ...noteData,
        ...(content !== undefined ? { content: content as object } : {}),
        ...(noteData.status === 'TRASHED' ? { deletedAt: new Date() } : noteData.status === 'ACTIVE' ? { deletedAt: null } : {}),
      },
      include: { category: true },
    });
    if (data.tagIds) await replaceNoteTags(note.id, req.userId!, data.tagIds);
    res.json({ note });
  } catch (error) { next(error); }
});
app.delete('/api/notes/:id', authenticate, async (req: AuthRequest,res,next) => {
  try {
    const noteId = String(req.params.id);
    const owned = await prisma.note.findFirst({ where: { id: noteId, userId: req.userId! } });
    if (!owned) return res.status(404).json({ error: 'Note not found' });
    await prisma.note.update({ where: { id: owned.id }, data: { status: 'TRASHED', deletedAt: new Date() } });
    res.status(204).send();
  } catch (error) { next(error); }
});
app.delete('/api/notes/:id/permanent', authenticate, async (req: AuthRequest,res,next) => {
  try {
    const result = await prisma.note.deleteMany({ where: { id: String(req.params.id), userId: req.userId!, status: 'TRASHED' } });
    if (!result.count) return res.status(404).json({ error: 'Trashed note not found' });
    res.status(204).send();
  } catch (error) { next(error); }
});
app.get('/api/categories', authenticate, async (req: AuthRequest,res,next) => {
  try { res.json({ categories: await prisma.category.findMany({ where: { userId: req.userId! }, orderBy: { name: 'asc' } }) }); }
  catch (error) { next(error); }
});
app.post('/api/categories', authenticate, async (req: AuthRequest,res,next) => {
  try {
    const data = categorySchema.parse(req.body);
    const category = await prisma.category.create({ data: { ...data, userId: req.userId! } });
    res.status(201).json({ category });
  } catch (error) { next(error); }
});
app.patch('/api/categories/:id', authenticate, async (req: AuthRequest,res,next) => {
  try {
    const data = categorySchema.partial().refine(value => Object.keys(value).length > 0).parse(req.body);
    const owned = await prisma.category.findFirst({ where: { id: String(req.params.id), userId: req.userId! } });
    if (!owned) return res.status(404).json({ error: 'Category not found' });
    const category = await prisma.category.update({ where: { id: owned.id }, data });
    res.json({ category });
  } catch (error) { next(error); }
});
app.delete('/api/categories/:id', authenticate, async (req: AuthRequest,res,next) => {
  try {
    const result = await prisma.category.deleteMany({ where: { id: String(req.params.id), userId: req.userId! } });
    if (!result.count) return res.status(404).json({ error: 'Category not found' });
    res.status(204).send();
  } catch (error) { next(error); }
});
app.get('/api/tags', authenticate, async (req: AuthRequest,res,next) => {
  try { res.json({ tags: await prisma.tag.findMany({ where: { userId: req.userId! }, orderBy: { name: 'asc' } }) }); }
  catch (error) { next(error); }
});
app.post('/api/tags', authenticate, async (req: AuthRequest,res,next) => {
  try {
    const data = tagSchema.parse(req.body);
    const tag = await prisma.tag.create({ data: { ...data, userId: req.userId! } });
    res.status(201).json({ tag });
  } catch (error) { next(error); }
});
app.patch('/api/tags/:id', authenticate, async (req: AuthRequest,res,next) => {
  try {
    const data = tagSchema.partial().refine(value => Object.keys(value).length > 0).parse(req.body);
    const owned = await prisma.tag.findFirst({ where: { id: String(req.params.id), userId: req.userId! } });
    if (!owned) return res.status(404).json({ error: 'Tag not found' });
    const tag = await prisma.tag.update({ where: { id: owned.id }, data });
    res.json({ tag });
  } catch (error) { next(error); }
});
app.delete('/api/tags/:id', authenticate, async (req: AuthRequest,res,next) => {
  try {
    const result = await prisma.tag.deleteMany({ where: { id: String(req.params.id), userId: req.userId! } });
    if (!result.count) return res.status(404).json({ error: 'Tag not found' });
    res.status(204).send();
  } catch (error) { next(error); }
});
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: error.issues });
  const prismaCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
  if (prismaCode === 'P1000' || prismaCode === 'P1001' || prismaCode === 'P1002') {
    return res.status(503).json({ error: 'The database is unavailable. Check the server DATABASE_URL and database connection.' });
  }
  if (prismaCode === 'P2021' || prismaCode === 'P2022') {
    return res.status(503).json({ error: 'The database schema is not initialized. Run the server migration command.' });
  }
  if (error instanceof Error && (error.message === 'CATEGORY_NOT_FOUND' || error.message === 'TAG_NOT_FOUND')) {
    return res.status(400).json({ error: error.message === 'CATEGORY_NOT_FOUND' ? 'Category not found' : 'Tag not found' });
  }
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
    return res.status(409).json({ error: 'An item with this name already exists' });
  }
  console.error(error);
  res.status(500).json({ error: 'An unexpected server error occurred' });
});
app.listen(port, () => console.log(`Noted API listening on :${port}`));
