# M&M Technology MRP Prototype UIs

This repository contains a high-level web front-end for the modernized MRP system for M&amp;M Technology. The goal is to provide a structured, data-aware user interface that mirrors the legacy database schema while preparing for a future API and database integration.

## Project Structure

```
assets/
  css/
    styles.css         # Global styling and layout tokens based on the teal brand palette
  js/
    app.js             # Shared behaviour for navigation state, breadcrumbs, and footer year
public/
  index.html           # Executive dashboard landing page
  inventory.html       # Material master, BOM, and inventory visibility
  production.html      # Forecasting, MRP, and capacity planning
  purchasing.html      # Purchase order and supplier collaboration
  sales.html           # Sales order, invoicing, and customer service
  workorders.html      # Shop floor execution, labor, and material issues
  suppliers.html       # Supplier master data and AVL tracking
  customers.html       # Customer master, pricing, and logistics
  reports.html         # Reporting, history, and compliance configuration
  settings.html        # System setup, shared codes, and security controls
```

Each page loads the shared navigation and styles and exposes the database entities it maps to using `data-entity` attributes. These attributes should be used when wiring up API calls and data-binding logic once the backend is available.

## Next Steps

1. Design the REST/GraphQL API layer that will hydrate each data table and card using the referenced legacy tables.
2. Build migration tooling to move data from the legacy schema into the new persistence tier.
3. Implement client-side state management (e.g., React, Vue, or vanilla modules) to replace placeholder sections with live data grids and forms.
4. Introduce authentication, authorization, and audit logging before exposing the UI to production users.

The current UI is static and contains no real data. It is intended as a blueprint for collaboration between product, design, and engineering teams.

## Backend Data Layer Tooling

Node.js and Prisma tooling has been added to the repository to support database introspection and local experimentation with the AWS RDS instance referenced by the `DATABASE_URL` environment variable.

* Install dependencies with `npm install`.
* For local development, copy `.env.example` to `.env` and provide the connection string for your database. Production deploys
  (e.g., on Vercel) should continue to source `DATABASE_URL` from their managed environment secrets.
* Generate the Prisma client with `npm run prisma:generate`.
* Pull the remote schema locally with `npm run prisma:introspect` and edit `prisma/schema.prisma` as models are refined.
* Run `npm run prisma:sync` to execute introspection and regenerate the Prisma client in a single step when the database schema changes.
* Use `npm run prisma:studio` for a visual interface and `npx prisma db seed` to execute `prisma/seed.ts` when seed data is required.

The Node entry point at `src/index.ts` is a lightweight connectivity check that can be expanded into scripts for one-off analysis or background jobs once the Prisma client has been generated.
