# Noted

A full-stack notes workspace inspired by the supplied reference. The repository is a TypeScript monorepo with a React client, Express API, Prisma ORM and PostgreSQL.

## Stack

- Node.js 24 LTS
- React 19.3 + TypeScript 7
- Vite 8 + Tailwind CSS 4
- Express 5
- Prisma ORM 7 (stable line) + PostgreSQL 18
- Lucide icons

Prisma ORM 8 is currently a release candidate, so this project deliberately uses the supported Prisma 7 line for a production-oriented baseline.

## Requirements

- Node.js 24.11+ (24 LTS recommended)
- npm 10+
- Docker Desktop or a PostgreSQL 18 instance

## Local setup

1. Install dependencies from the repository root:

   ```bash
   npm install
   ```

2. Start PostgreSQL:

   ```bash
   docker compose up -d postgres
   ```

3. Configure the API environment:

   ```bash
   Copy-Item server\.env.example server\.env
   ```

   In PowerShell, replace `JWT_SECRET` with a unique secret of at least 32 characters. On macOS/Linux, use `cp server/.env.example server/.env`.

4. Generate Prisma Client and apply the checked-in database migrations:

   ```bash
   npm run db:generate -w server
   npm run db:deploy -w server
   ```

   Use `npm run db:migrate -w server -- --name <description>` when creating a new migration during development.

5. Start the client and API:

   ```bash
   npm run dev
   ```

   Client: http://localhost:5173  
   API and database health: http://localhost:4000/api/health

If sign-in or sign-up reports that the API cannot be reached, run `npm run dev` from the repository root so both the client and API start. The health URL should return `"status":"ok"` and `"database":"connected"`.

## Current implementation status

- Public Home and About pages, account registration and sign-in screens, and a protected-by-session notes workspace.
- API-backed note editing with debounced autosave, search, favorites, pinning, archive, trash, restore and permanent deletion.
- User-managed categories and tags, including assigning tags to notes.
- Interlinked notes using the page-link control in the editor; linked pages and backlinks are clickable.
- Responsive layouts for desktop and mobile.
- Express API with registration, login, notes, categories and tags endpoints.
- Prisma data model for users, notes, categories, tags and note-tag relationships.
- Initial PostgreSQL migration checked in and aligned Prisma CLI, Client and driver adapter versions.
- Security baseline: Helmet, CORS allow-list, API rate limiting, Zod request validation, password hashing and JWT verification.

## Before production

- Configure PostgreSQL, apply Prisma migrations, and set a unique `JWT_SECRET` of at least 32 characters as described in Local setup.
- Configure `CLIENT_ORIGIN` for the deployed client. Set `VITE_API_URL` on the client only when overriding the production API origin.
- Add password reset, email verification, refresh-token/session revocation and a secure cookie strategy.
- Add conflict handling for simultaneous edits, a maintained rich-text editor, and automated integration/browser tests.
- Use HTTPS, managed PostgreSQL, a secret manager, database backups and observability.

The client now uses the API rather than demo-only note state. Account and note data require the configured API and database to be available.

## Vercel deployment

Deploy the client and API as separate Vercel projects. Set the client project's root directory to `client`, and set the API project's root directory to `server`.

On the API project, configure `DATABASE_URL`, `JWT_SECRET` (at least 32 characters), and `CLIENT_ORIGIN` as the exact client origin, for example `https://note-taking-app-a.vercel.app`. Deploy the API, then verify that `https://<api-deployment-domain>/api/health` returns `"status":"ok"` and `"database":"connected"`.

The client uses `https://note-taking-app-server-rho.vercel.app` as its production API origin. If you deploy the API elsewhere, set `VITE_API_URL` in the client project to the API deployment origin only, without a trailing slash or `/api`. This variable is embedded at build time, so redeploy the client after changing it. The client calls the API under `/api`.
