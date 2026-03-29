# カスタムマップ (Custom Map)

## Overview
A static web application that displays a custom interactive map using MapLibre GL. The app is written in Japanese and includes custom map data layers for castles, roads (michi), manholes, and Pokémon locations.

## Project Structure
- `index.html` — Main application entry point with the map UI
- `data.js` — Core map data
- `castle.js` — Castle location data layer
- `michi.js` — Road/path data layer
- `manhole.js` — Manhole cover data layer
- `pokemon.js` — Pokémon location data layer
- `manifest.json` — PWA manifest (supports standalone/installable mode)
- `icon.svg` — App icon
- `*.png` — Image assets for map markers

## Tech Stack
- **MapLibre GL** v3.6.2 (CDN) — Interactive map rendering
- **Pure HTML/CSS/JS** — No build system or package manager
- **PWA** — Progressive Web App with offline capability via manifest

## Running the App
The app is served as a static site using `serve`:
```
npx serve -l 5000 .
```
Workflow: "Start application" on port 5000

## Deployment
Configured as a **static** deployment with `publicDir: "."`.
