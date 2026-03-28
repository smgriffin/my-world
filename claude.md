{\rtf1\ansi\ansicpg1252\cocoartf2869
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 # My World \'97 Project Brief\
\
## What this is\
A personal history timeline web app. A desktop-first web app where users map events \'97 cosmic, world, local, and personal \'97 on a single timeline stretching from the Big Bang to today. Built incrementally as the user learns and discovers. Shaped entirely by what they find interesting.\
\
## Core philosophy\
- Local-first \'97 all data stored in IndexedDB, nothing leaves the browser\
- Legible at every zoom level \'97 never overwhelming\
- Mapped, visual, slightly immersive \'97 a good place to be\
- Restraint over features \'97 do fewer things perfectly\
\
## Tech stack\
- Vanilla HTML, CSS, JavaScript \'97 no framework, no build tools\
- IndexedDB via Dexie.js for local storage\
- HTML Canvas for timeline rendering (logarithmic scale)\
- Wikipedia API for historical event autocomplete\
- Microlink API for link preview fetching\
- No backend, no auth, no server\
\
## File structure\
- index.html \'97 entry point\
- css/main.css \'97 all styles\
- js/timeline.js \'97 canvas rendering, zoom, pan\
- js/entries.js \'97 IndexedDB CRUD via Dexie\
- js/render.js \'97 markers, clustering, DOM cards\
- js/ui.js \'97 modal, list panel, search\
- js/background.js \'97 zone-based backgrounds\
- js/sound.js \'97 ambient audio\
\
## Timeline mechanics\
- Logarithmic scale from Big Bang (13.8B years ago) to today\
- Google Maps-style interaction: scroll wheel zooms, click-drag pans horizontally only\
- Zone-based backgrounds that shift as you zoom:\
  - Cosmic (zoomed out): deep space, stars, nebulae\
  - Geological: dark greens, rock strata\
  - Ancient/Medieval: warm parchment, candlelight, manuscript feel\
  - Modern: dark editorial, museum grid\
- Backgrounds are STATIC \'97 no constant animation\
\
## Entry types\
- Historical: autocompleted from Wikipedia, pulls title/summary/photo\
- Personal: freeform, user writes and uploads photos\
- One date = point on line, two dates = span bar (automatic, no toggle)\
\
## Features already designed (build these)\
- Add / edit / delete entries\
- Multiple photos per entry with lightbox\
- Links with auto-preview (title, thumbnail, domain via Microlink)\
- Search that filters both timeline markers and list panel simultaneously\
- Left side list panel (togglable) \'97 reverse chronological default, sortable\
- Marker clustering when entries overlap\
- Export/import as JSON\
- Ambient drone sound, mutable\
\
## Entry data shape\
```json\
\{\
  "id": "string",\
  "title": "string",\
  "year": "number",\
  "yearEnd": "number | null",\
  "type": "historical | personal",\
  "summary": "string",\
  "image": "string (URL)",\
  "notes": "string",\
  "photos": ["base64 strings"],\
  "links": [\{"url","title","description","image","domain"\}],\
  "tags": ["strings"],\
  "entryType": "Event | Person | Source | Location | Claim"\
\}\
```\
\
## Design language\
- Fonts: Cinzel (headings/UI), EB Garamond (body), Cormorant Garamond (dates/italic)\
- Accent: #c9a84c (gold)\
- Background: near-black, shifts by era\
- Cards: newspaper clipping style \'97 hero image, dateline, title, summary, notes, link previews\
- Everything dark, warm, slightly aged\
\
## What NOT to build\
- No React, Vue, or any framework\
- No backend or database server\
- No user accounts or cloud sync (yet)\
- No mobile optimization (yet)\
- No social features\
\
## Current phase\
Building from scratch with clean file separation. The prototype existed as a single HTML file \'97 this is the proper implementation.}