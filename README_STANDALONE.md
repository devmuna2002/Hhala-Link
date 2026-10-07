# Hlala Link — Standalone Database & System Architecture Manual

This document provides a comprehensive guide on how the Hlala Link standalone system works, how to start and operate it, and how mobile/web clients communicate with it without relying on Supabase Cloud.

---

## 1. System Overview & Architecture

When Supabase Cloud services were restricted due to egress/quota limits, the backend was decoupled from Supabase Cloud and replaced with an **independent, self-hosted Node.js + SQLite engine**.

```
┌─────────────────────────────────────────────────────────────┐
│                       CLIENT APPS                           │
│  • Mobile App (Expo / React Native - iOS & Android)         │
│  • Web Application (http://localhost:3000)                  │
│  • Admin Dashboard                                          │
└──────────────────────────────┬──────────────────────────────┘
                               │ Supabase-JS SDK Requests
                               │ (REST, Auth, Storage)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│           HLALA LINK STANDALONE SERVER (PORT 8000)          │
│               standalone-database/standalone-server.js      │
├─────────────────────────────────────────────────────────────┤
│  • /health             Health check endpoint                │
│  • /auth/v1/*          Sign-up, Token (login), JWT, Refresh │
│  • /rest/v1/*          Full PostgREST query parser (CRUD)   │
│  • /storage/v1/*       Multipart uploads & file serving     │
└──────────────────────────────┬──────────────────────────────┘
                               │ Native SQLite bindings
                               │ (node:sqlite with WAL mode)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 PERSISTENT LOCAL STORAGE                    │
│  • Database: standalone-database/data/hlala_link.db         │
│  • Media:    standalone-database/storage/                   │
└─────────────────────────────────────────────────────────────┘
```

### Key Principles
1. **100% Client-Side Compatibility**: 
   The mobile app and frontend still use `@supabase/supabase-js`. No screen, component, or query logic needed to be rewritten.
2. **Zero External Dependencies**:
   Runs using Node.js's built-in `node:sqlite` database engine and `crypto` libraries. No Docker, Postgres, or cloud subscriptions required.
3. **High-Performance Concurrency**:
   SQLite is configured with **WAL (Write-Ahead Logging)** mode (`PRAGMA journal_mode=WAL`), allowing simultaneous reads and writes without database locks.

---

## 2. Directory Structure

```
c:\Users\Munashe\Desktop\Hlala Link\
│
├── server.js                          # Main server (Port 3000 Web + boots DB on Port 8000)
├── standalone-database\
│   ├── standalone-server.js           # Supabase-compatible API & SQLite engine (Port 8000)
│   ├── migrate-from-supabase.js       # Migration script that imported all cloud data
│   ├── data\
│   │   └── hlala_link.db              # Persistent SQLite database file
│   └── storage\                       # Local file storage (avatars, property images)
│
├── app\                               # Expo / React Native Mobile Application
│   ├── .env                           # Mobile environment config (points to Port 8000)
│   ├── app.json                       # Expo configuration (iOS ATS & Android permissions)
│   ├── supabase.js                    # Mobile Supabase client connection resolver
│   ├── App.js                         # Mobile root navigation and session management
│   └── screens\                       # All mobile screens (Auth, Home, Chat, etc.)
```

---

## 3. How to Run the System

### Step 1: Start the Backend Server (Database + Web)
Open a terminal in the root folder (`c:\Users\Munashe\Desktop\Hlala Link`):

```powershell
node server.js
```

This single command starts:
- **Standalone Database & API**: `http://localhost:8000` (and `http://<your-lan-ip>:8000`)
- **Website Frontend**: `http://localhost:3000`

> [!TIP]
> You can verify the server is running anytime by opening `http://localhost:8000/health` in your browser. It will return `{"status": "healthy"}`.

---

### Step 2: Start the Mobile Application (Expo)
Open a second terminal in the `app` directory (`c:\Users\Munashe\Desktop\Hlala Link\app`):

```powershell
npx expo start -c
```

The `-c` flag ensures Metro clears stale bundle caches and loads the current network configuration.

- **On an iPhone or Android phone**: Open the camera app (iOS) or Expo Go app (Android) and scan the QR code displayed in the terminal.
- **On Web**: Press `w`.
- **On Android Emulator**: Press `a`.
- **On iOS Simulator**: Press `i`.

---

## 4. Mobile Device Network Configuration

When running Expo on a **physical mobile phone**, the phone needs to reach your computer across your local network.

### Finding Your Computer's LAN IP
If your Wi-Fi reconnects or router assigns a new IP address, check your IP in PowerShell:

```powershell
ipconfig
```
Look for **IPv4 Address** under `Wireless LAN adapter Wi-Fi` (e.g., `192.168.100.145`).

### Updating the App's Connection
Ensure `app/.env` matches your computer's IP:
```env
EXPO_PUBLIC_SUPABASE_URL=http://192.168.100.145:8000
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImhsYWxhLXN0YW5kYWxvbmUiLCJpYXQiOjE3OTA4OTU1MDAsImV4cCI6MjEwNjI1NTUwMH0.6o4swyqP9xKgQcZGU_W1SWMY0vL2ucTOC8P_1O7bfZM
```

> [!IMPORTANT]
> Both your phone and your computer **must be connected to the same Wi-Fi network**. If your phone is using mobile cellular data (Econet, NetOne, etc.), it cannot reach local network IP addresses.

---

## 5. User Accounts & Login Credentials

All users, profiles, properties, mover profiles, messages, and notifications were migrated from Supabase into `hlala_link.db`.

| Account | Email | Password | Role | Notes |
|---|---|---|---|---|
| **System Admin** | `admin@hlalalink.com` | `admin1234` | `admin` | Full admin privileges |
| **Developer / Owner** | `munasheantonio1@gmail.com` | `Hlala2024!` *(or your personal password)* | `admin` | Auto-claims whatever password you enter |
| **Migrated Profiles (13 users)** | e.g. `pmasina309@gmail.com`, etc. | `Hlala2024!` | Various | Profiles, listings, and messages preserved |

### How Auto-Claim Authentication Works
Because Supabase Cloud security never exports plain text passwords or password hashes, the standalone server includes an **Auto-Claim Protocol**:
- Migrated users can log in using the temporary password **`Hlala2024!`**.
- **Alternatively**, when a migrated user enters their email and any personal password they prefer on first login, the server automatically accepts it, generates a secure PBKDF2 hash, and saves it permanently to the database.

---

## 6. How Database Operations Work Under the Hood

### 1. Authentication (`/auth/v1/*`)
- **Signup (`POST /auth/v1/signup`)**: Hashes the password with PBKDF2 (SHA-256), creates records in `users` and `profiles`, and returns a 30-day JWT.
- **Login (`POST /auth/v1/token?grant_type=password`)**: Verifies credentials, checks auto-claim logic for migrated accounts, and issues a standard Bearer token.
- **Session Refresh (`POST /auth/v1/token?grant_type=refresh_token`)**: Issues a refreshed JWT.
- **Profile / Password Update (`PUT /auth/v1/user`)**: Allows users to change their password or update metadata.

### 2. REST API (`/rest/v1/*`)
The standalone server implements a PostgREST query parser:
- **Filtering**: Supports `eq.`, `neq.`, `in.()`, `ilike.`, `gt.`, `lt.`
- **Sorting**: Parses `order=column.desc` into SQL `ORDER BY "column" DESC`
- **Relations**: Automatically joins `property_images` to `properties`, attaches owner details, and attaches mover vehicles and reviews.
- **RPC Calls (`/rest/v1/rpc/*`)**: Emulates stored procedures such as user approvals, nearby listings search, and status checks.

### 3. File & Image Storage (`/storage/v1/*`)
- **Upload (`POST /storage/v1/object/:bucket/:filename`)**: Streams binary image data directly to `standalone-database/storage/:bucket/:filename`.
- **Public Serving (`GET /storage/v1/object/public/:bucket/:filename`)**: Streams the images with appropriate MIME headers (`image/jpeg`, `image/png`, etc.).

---

## 7. Backups and Maintenance

### Backing Up the Database
Because the database is a self-contained SQLite file, backups are straightforward:
1. Make a copy of:
   ```
   c:\Users\Munashe\Desktop\Hlala Link\standalone-database\data\hlala_link.db
   ```
2. Store the copy on an external drive, cloud drive, or backup folder.

### Backing Up Uploaded Files
Uploaded property images and avatars are stored in:
```
c:\Users\Munashe\Desktop\Hlala Link\standalone-database\storage\
```
Back up this folder alongside the database file.

---

## 8. Common Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `fetch failed: A server with the specified hostname could not be found` | Phone is trying to reach `localhost` or old cloud domain | Update `app/.env` with your computer's Wi-Fi IP and restart Metro with `npx expo start -c`. Force-close and re-open Expo Go on the phone. |
| `Network request failed` | Phone and PC are on different networks, or router has AP Isolation | Connect both phone and PC to the same Wi-Fi. Verify by visiting `http://<your-ip>:8000/health` in mobile Safari/Chrome. |
| `Invalid login credentials` | Mismatched password | Use `Hlala2024!` or enter your personal password to auto-claim the account. |
| `EADDRINUSE: address already in use :::8000` | Another instance of the server is running | Kill existing Node processes with `Stop-Process -Name "node" -Force` in PowerShell, then run `node server.js`. |
