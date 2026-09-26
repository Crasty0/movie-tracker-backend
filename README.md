# Movie Tracker — Backend

A REST + WebSocket API built with Node.js and Koa, serving as the backend for the
[Android movie tracker app](https://github.com/Crasty0/movie-tracker-android).

## Features

- JWT-style token authentication, with per-user data isolation
- Full CRUD REST API for movies
- Real-time updates: create/update/delete events are pushed to connected clients over WebSocket
- Optimistic concurrency control — updates carry a version number, and conflicting writes are
  rejected with `409 Conflict` instead of silently overwriting each other
- Centralized error-handling and request-logging middleware

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login` | Authenticate and receive a token |
| GET | `/movie` | List the authenticated user's movies |
| GET | `/movie/:id` | Get a single movie |
| POST | `/movie` | Create a movie |
| PUT | `/movie/:id` | Update a movie (version-checked) |
| DELETE | `/movie/:id` | Delete a movie |

All `/movie` routes require `Authorization: Bearer <token>`.

## Real-time updates

Clients connect to the WebSocket server with `?token=<token>` in the URL. On any create, update,
or delete, the server broadcasts the change only to clients authenticated as the movie's owner —
so one user's edits never leak into another user's session.

## Tech Stack

- Node.js
- Koa (web framework) + koa-router
- `ws` for WebSocket
- In-memory data store (no database — this is a lab/learning project, not production-hardened)

## Running locally

```bash
npm install
npm start
```

Server listens on `http://localhost:3000`.

## Notes

Built as a solo university lab project (Babeș-Bolyai University) to pair with a native Android
client, focusing on REST design, real-time sync, and basic concurrency handling.
