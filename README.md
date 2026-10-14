# Student Beneficiary System

Full-stack application for managing student beneficiary records.

## Stack

- **Frontend:** React
- **Backend:** Node.js + Express
- **Database:** PostgreSQL

## Project Structure

```
student-beneficiary-system/
├── backend/     # Express API server
└── frontend/    # React client app
```

## Getting Started

Install dependencies once:

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

Set `DATABASE_URL` and `JWT_SECRET` in `backend/.env`, then start the API and
frontend together from this directory:

```bash
npm start
```

Open `http://localhost:4173`. The API runs on port 5000 and is proxied by Vite.
