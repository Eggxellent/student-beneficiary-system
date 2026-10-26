# Render deployment (staging)

This repository now has a Docker-based deployment path for a single Render web service: the React frontend is built into static files, Express serves those files and the API on the same origin, and Python dependencies are installed in the container.

## Render service settings

- Runtime: Docker
- Branch: `codex/render-deployment` for staging; do not deploy from `main` as part of this work
- Dockerfile path: `./Dockerfile`
- Health check path: `/api/health`
- Plan: choose an appropriate plan in the Render dashboard

## Required environment variables

- `DATABASE_URL`: the **internal** connection URL for the Render PostgreSQL database in the same workspace/region where possible
- `JWT_SECRET`: a long, randomly generated secret; set it in Render's environment settings, never commit it
- `NODE_ENV=production`
- `CORS_ORIGIN`: set this to the exact deployed frontend origin, for example `https://your-service.onrender.com`. If hosting the frontend separately, use its trusted origin(s), comma-separated. The current CORS middleware requires the request origin to be allowlisted.

Do not commit credentials or paste database URLs into source control.

## Database setup

The API expects `DATABASE_URL` and does not automatically initialize or migrate the database. Before connecting a live service, review `backend/src/db/schema.sql` and all SQL changes against the current code, apply them to the Render database through an authorized database session, and verify the expected tables. Do not point the deployed app at a local PostgreSQL address.

## Release blockers

**Do not treat the app as production-ready yet.**

1. Public registration has been changed so client input cannot assign an administrator role. The updated authentication test asserts the resulting role is `field_officer`. Administrator accounts must be provisioned through a controlled, authorized process.
2. The predictor expects `ml-service/model/rf_duplicate_model.joblib`, but that production artifact is not in the repository. The available `model/research/rf_attachment_style_candidate.joblib` is a research candidate evaluated on synthetic data only. The API now fails safely when the production model is absent; duplicate screening will not work until an approved compatible model is supplied and tested.
3. The current predictor is Random Forest, not the planned XGBoost/Jaro-Winkler production model. Do not claim the XGBoost model is integrated until its feature contract, saved artifact, and evaluation are verified.
4. Run backend tests and smoke tests, then verify login, authorization, student registration, duplicate review, disbursement safeguards, and frontend routes before exposing the service to real users.

Use synthetic/demo records only during staging validation. Duplicate model output must support human review, not make an irreversible decision by itself.
