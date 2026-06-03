# OSDU Data Manager

A web-based explorer and management interface for the [OSDU Data Platform](https://osduforum.org/). Browse, search, and inspect subsurface energy data records, schemas, legal tags, and reservoir resources — all from a fast, keyboard-friendly UI.

**Live at [osdudatamanager.com](https://osdudatamanager.com)**

---

## Capabilities

### Connection & Authentication
- Connect to any OSDU instance using OAuth2 client credentials (Base URL, Data Partition ID, Token Endpoint, Client ID / Secret, Scope)
- Import connection settings directly from a **Postman Environment file** — field mapping is automatic
- Persistent global connection indicator shows the active Base URL across every panel

### Record Search
- Query records using **Lucene syntax** with Kind filters
- Recent search history with one-click recall
- High-performance results table with persistent **column resizing, reordering, and visibility** settings (saved per browser)
- Click any row to open the full record detail view

### Record Detail
- Four-tab layout: **Data** (full JSON payload), **ACL & Legal**, **Meta & Tags**, **History** (version list)
- Deep-links to individual record versions

### JSON Viewer
- Custom tree renderer for large, deeply-nested payloads
- **In-viewer search** with key and value highlighting
- **Expand/collapse state** saved per record (100 most recent layouts persisted)
- **Pop-out window** — open any JSON in a standalone tab; state stays in sync via `BroadcastChannel`
- One-click **Storage lookup** and **Wellbore DMS lookup** for any UUID referenced in the payload

### Schema Browser
- List and filter all OSDU schemas by Authority, Source, and Entity Type
- Double-click any schema to open its full JSON definition in the viewer

### Legal Tags
- Browse all valid legal tags with descriptions, country of origin, and contract IDs

### Reservoir DMS (RDMS)
- Dedicated explorer for Reservoir Domain Management Services
- Navigate by **Dataspace → Resource Type → Record**
- Double-click any record row to open its full JSON in a fullscreen viewer
- Click any UUID in the JSON to auto-select it; the Search button resolves the correct `resqml` data type from the payload and fetches the linked record

### Network Console
- Resizable bottom panel capturing every API call between the app and the OSDU platform
- Shows method, URL, status, response time, request/response headers and bodies — useful for debugging queries and auth issues

---

## Stack

- **Frontend:** React 19, Vite, Wouter, TanStack Query v5, Tailwind CSS, Radix UI / shadcn
- **Backend:** Node.js 24, Express 5, Drizzle ORM, PostgreSQL
- **API contract:** OpenAPI spec → Orval codegen (React Query hooks + Zod schemas)
- **Monorepo:** pnpm workspaces, TypeScript 5.9, esbuild

---

## Running Locally

```bash
# Install dependencies
pnpm install

# Start the API server (port 5000)
pnpm --filter @workspace/api-server run dev

# Start the frontend (separate terminal)
pnpm --filter @workspace/osdu-explorer run dev
```

Required environment variable: `DATABASE_URL` — a PostgreSQL connection string.

Regenerate API client after spec changes:

```bash
pnpm --filter @workspace/api-spec run codegen
```
