# 🥏 ProIsPro – Disc Inventory

A personal disc golf bag tracker with **cloud sync** via Supabase, GitHub OAuth authentication, and offline-first fallback to localStorage.

Hosted on **GitHub Pages** at **proispro.com**.

The product is being prepared for the **Griplock** name and a staged Azure
migration. The running frontend now uses React, TypeScript, and Vite; the
Alpine.js/no-build descriptions below are historical.

For current local checks, GitHub Actions, test evidence, and Azure OIDC bootstrap,
see [GitHub delivery foundation](docs/github-pipelines.md). Production Pages
publishing is now owner-dispatched, not automatic on every main push.

## Features

- 📦 **Add / Edit / Remove** discs from your bag
- 🔍 **Search & filter** by type (Putter · Midrange · Fairway · Distance)
- 🗂 **Sort** by name, type, weight, or date added
- ☁️ **Cloud sync** — discs saved to Supabase PostgreSQL, accessible from any device
- 🔐 **GitHub OAuth login** — secure, passwordless authentication
- 💾 **Offline-first** — app works in localStorage mode if cloud is unavailable
- 📤 **Export** your bag to a JSON file to share with friends
- 📥 **Import** a friend's bag JSON and merge it with yours
- 📱 **Fully responsive** – works great on your phone at the course

## Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Alpine.js (CDN) + vanilla CSS with OKLCH color system |
| **Backend** | Supabase PostgreSQL with Row-Level Security (RLS) |
| **Auth** | Supabase Auth – GitHub OAuth provider |
| **Hosting** | GitHub Pages (static, no build step) |

## Getting Started

### 1. Local Development (No Cloud)

Simply open `index.html` in your browser. The app works in **localStorage mode** — all data is stored locally in your browser.

### 2. With Supabase Backend (Cloud Sync)

See `[docs/supabase-setup.md](docs/supabase-setup.md)` for full setup instructions.

## Architecture Overview

**Frontend:** `index.html` loads Alpine.js and Supabase client via CDN. No build step. ~250 lines of reactive JavaScript.

**Backend:** Supabase PostgreSQL database with Row-Level Security policies ensuring users can only access their own discs.

**Auth:** GitHub OAuth via Supabase Auth. Users log in with GitHub → receive JWT → all database queries validated by RLS.

**Offline fallback:** If Supabase is unavailable, app silently falls back to localStorage. User can still view/edit discs locally; changes sync when cloud is available.

## Fields Tracked per Disc

| Field | Example |
|-------|---------|
| Name | Destroyer |
| Manufacturer | Innova |
| Type | Distance Driver |
| Plastic | Star |
| Weight | 175 g |
| Color | Red |
| Condition | Good |
| Flight numbers | 12 / 5 / -1 / 3 |
| Notes | Free-text notes |
| Added | 2026-04-20 |
