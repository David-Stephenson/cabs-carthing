# OSU CABS Dashboard

SvelteKit live map for Ohio State **Campus Area Bus Service (CABS)**. Pick a route and stop, bookmark the URL (`/map?route=…&stop=…`), and watch vehicles on a Mapbox map with ETAs and a fleet list.

## Prerequisites

- Node.js 20+ (recommended)
- A [Mapbox](https://www.mapbox.com/) access token (`PUBLIC_MAPBOX_TOKEN`)

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and set your Mapbox token and optional style URL.
3. Run the dev server: `npm run dev`

### Environment

| Variable | Purpose |
|----------|---------|
| `PUBLIC_MAPBOX_TOKEN` | Mapbox GL token (required for the map) |
| `PUBLIC_MAP_STYLE` | Map style URL, e.g. `mapbox://styles/...` |

Example bookmark after the app is running: `/map?route=CC&stop=501`

The bus 3D model is served from `static/Bus.glb`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with Vite |
| `npm run build` | Production build (Cloudflare adapter output) |
| `npm run preview` | Preview the production build locally |
| `npm run preview:cf` | Preview with Wrangler against Cloudflare Pages output |
| `npm run check` | `svelte-check` + sync |

## Deployment

This project uses `@sveltejs/adapter-cloudflare`. Build with `npm run build`, then deploy the generated output with [Cloudflare Pages](https://developers.cloudflare.com/pages/) (or `wrangler pages deploy` as documented in your workspace).

Set the same `PUBLIC_*` variables in your hosting provider’s environment settings.

## Repository

```bash
git clone git@github.com:David-Stephenson/OSU-Cabs-Dasdhboard.git
cd OSU-Cabs-Dasdhboard
```

HTTPS: `https://github.com/David-Stephenson/OSU-Cabs-Dasdhboard.git`

## License

ISC
