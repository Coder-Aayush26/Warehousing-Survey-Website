# Deployment

This project is split into:

- Frontend: Vite/React at the repository root, deployable on Vercel.
- Backend: Express API in `backend/`, deployable on Render.

## 1. Deploy Backend On Render

Create a new Render Web Service from this repository.

Recommended settings:

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

Environment variables:

- `MONGODB_URI`: MongoDB Atlas connection string.
- `JWT_SECRET`: long random secret string.
- `ADMIN_USERNAME`: admin login username.
- `ADMIN_PASSWORD`: admin login password.
- `NODE_ENV`: `production`

After Render deploys, copy the backend URL, for example:

```text
https://indian-warehousing-survey-backend.onrender.com
```

The API health check should work at:

```text
https://your-render-service.onrender.com/api/health
```

## 2. Deploy Frontend On Vercel

Create a Vercel project from this repository.

Recommended settings:

- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

Environment variable:

- `VITE_API_URL`: your Render backend URL plus `/api`

Example:

```text
VITE_API_URL=https://indian-warehousing-survey-backend.onrender.com/api
```

Redeploy the Vercel project after adding or changing `VITE_API_URL`.

## Notes

- Keep secrets out of Git. Do not commit `.env` files.
- If MongoDB Atlas blocks Render, allow network access from anywhere using `0.0.0.0/0` or use Atlas settings appropriate for your security needs.
- Render free services may sleep after inactivity, so the first API request can be slow.
