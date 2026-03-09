# CABS Testing

SvelteKit app for tracking the Ohio State CABS Mount Hall stop, configured for Vercel deployment.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` if you need to replace the Mapbox token or API URLs.
3. Start the app with `npm run dev`.

## Build

- Run `npm run build` to generate the Vercel deployment output.
- Run `npm run preview` to serve the app locally.
- The bus model is served from `static/Bus.glb`.

For GitHub-backed deployment on Vercel, push the repo and import it in Vercel.
