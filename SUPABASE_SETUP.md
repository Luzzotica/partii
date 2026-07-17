# Supabase Setup Guide

This document explains how to set up Supabase for the Partii platform.

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click "New Project"
3. Fill in your project details:
   - **Name**: `partii-platform` (or whatever you prefer)
   - **Database Password**: Generate a strong password and save it
   - **Region**: Choose the closest to your users
4. Click "Create new project" and wait for it to be ready

## 2. Get Your API Keys

1. Go to **Settings** > **API** in your Supabase dashboard
2. Copy the following values into your `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## 3. Run Database Migrations

Go to the **SQL Editor** in your Supabase dashboard and run the migration files in order:

### Migration 1: Initial Schema
Copy and paste the contents of `supabase/migrations/001_initial_schema.sql` and run it.

This creates:
- `profiles` table (user profiles linked to auth)
- `high_scores` table (game scores for leaderboards)
- `game_sessions` table (analytics tracking)
- `purchases` table (for future use)
- `leaderboard` view (aggregated leaderboard data)
- Auto-create profile trigger on user signup

### Migration 2: Realtime Presence
Copy and paste the contents of `supabase/migrations/002_realtime_presence.sql` and run it.

This enables:
- Real-time subscriptions for high scores and game sessions
- Presence logging table for analytics

## 4. Enable Authentication Providers (Optional)

To enable OAuth login (Google, GitHub, Discord):

1. Go to **Authentication** > **Providers**
2. Enable the providers you want:

### Google OAuth
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Go to **APIs & Services** > **Credentials**
4. Create an OAuth 2.0 Client ID
5. Add authorized redirect URI: `https://your-project-id.supabase.co/auth/v1/callback`
6. Copy Client ID and Secret to Supabase

### GitHub OAuth
1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set callback URL to: `https://your-project-id.supabase.co/auth/v1/callback`
4. Copy Client ID and Secret to Supabase

### Discord OAuth
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to OAuth2 and add redirect: `https://your-project-id.supabase.co/auth/v1/callback`
4. Copy Client ID and Secret to Supabase

## 5. Enable Realtime

For the real-time presence feature to work:

1. Go to **Database** > **Replication**
2. Under "supabase_realtime", enable the following tables:
   - `high_scores`
   - `game_sessions`

## 6. Environment Variables Summary

Create a `.env.local` file with:

```env
# Required - Public keys (safe to expose in browser)
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Required - Server-side only (NEVER expose to browser)
# Used for admin operations like inserting high scores
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Get the service role key from **Settings** > **API** > **service_role** (under "Project API keys").

## Features Overview

### Authentication
- Email/password signup and login
- OAuth with Google, GitHub, Discord
- Auto-create profile on signup
- Persistent sessions with SSR support

### High Scores & Leaderboards
- Submit scores after each game
- Personal best tracking
- Global leaderboard with top scores
- User rank display

### Analytics
- Track game sessions (start/end time, final score)
- Session analytics per game
- Play count tracking

### Real-time Presence
- See how many users are online
- See how many are playing each game
- Live updates using Supabase Realtime

### Purchases (Future)
- Table structure ready for player purchases
- Integrates with Stripe payment intent IDs

## File Structure

```
lib/supabase/
├── client.ts           # Browser client
├── server.ts           # Server client (SSR)
├── middleware.ts       # Session refresh middleware
├── types.ts            # TypeScript types for database
├── auth-context.tsx    # Auth provider and hook
└── hooks/
    ├── index.ts
    ├── useGameSession.ts   # Analytics tracking
    ├── useHighScores.ts    # Leaderboard functionality
    └── usePresence.ts      # Real-time online users

components/auth/
├── AuthModal.tsx       # Login/signup modal
├── AuthModal.module.css
├── UserMenu.tsx        # User dropdown menu
└── UserMenu.module.css

supabase/migrations/
├── 001_initial_schema.sql
└── 002_realtime_presence.sql
```

## Troubleshooting

### "Invalid API key" error
- Make sure you copied the **anon** key, not the service role key
- Check that there are no extra spaces in your `.env.local`

### OAuth not redirecting back
- Ensure your redirect URL in the OAuth provider matches exactly
- Check that the provider is enabled in Supabase

### Real-time not updating
- Make sure tables are enabled in Replication settings
- Check browser console for WebSocket connection errors

### Scores not submitting
- User must be logged in to submit scores
- Check RLS policies are applied correctly
