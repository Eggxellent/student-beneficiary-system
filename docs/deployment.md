# SBMS API container

> **Project status:** Azure deployment has already been completed. This file documents the existing container and hosting configuration for technical reference. The current project phase is local testing and verification; the operational commands below are not a request or plan to deploy, redeploy, migrate, or change production. Do not infer that the current local worktree is deployed.

The repository `Dockerfile` builds the SBMS API and its Python duplicate predictor in one image. The build copies the tracked production artifact to `/app/ml-service/model/xgb_duplicate_model.joblib` and loads it during the image build to fail early if the artifact or its Python dependencies are invalid. `.dockerignore` excludes the research experiment and all other joblib artifacts; the research model is never a substitute.

The Node API invokes `ml-service/predict.py` as a child process. The image sets `PYTHON_EXECUTABLE` to its virtual-environment interpreter. Outside the image, the backend checks that setting first, then the platform-appropriate Python virtual-environment paths.

The API image does not contain or serve the frontend. Keep model artifacts out of any frontend/static-site publish directory. The frontend defaults to the relative `/api` path locally; `VITE_API_ORIGIN` can point it at a separate API origin for production. The deployed topology is Azure: the image runs in Container App `ca-sbms-api` (`rg-sbms`, `minReplicas 0`) and the built frontend is zip-deployed to App Service `sbms-web` with `VITE_API_ORIGIN` set to the Container App FQDN; the SPA fallback belongs to the App Service configuration, not to the image. See `docs/azure-deployment-plan-2026-10-30.md` and the scripts in `deploy/azure/`.

API startup now checks the configured database name and verifies that
`public.users` resolves unambiguously with the login columns `id`, `full_name`,
`email`, `password_hash`, `role`, and `is_active`. It refuses to listen when
the database is unreachable, the name is unexpected, or the authentication
schema is incomplete. Startup does not change database contents.

`GET /api/health` is process liveness after startup. `GET /api/ready` performs
a read-only query through the API pool and checks the configured database name
plus the presence and resolution of the required public tables. It returns
only a generic status. Set the non-secret `SBMS_EXPECTED_DATABASE_NAME` to the
approved target database. Readiness does not verify every column, constraint,
index, migration, or record.

For a database confirmed empty and separately approved for initialization, the
one-time command is `npm run db:bootstrap-empty --prefix backend`. It requires
`SBMS_INITIALIZE_EMPTY_DATABASE=true`,
`SBMS_EMPTY_SCHEMA_BOOTSTRAP_APPROVED` equal to the expected database name, and
private `SBMS_BOOTSTRAP_ADMIN_EMAIL` / `SBMS_BOOTSTRAP_ADMIN_PASSWORD` values.
The command refuses pre-existing non-extension public relations, routines, or
custom types. It creates the schema, applies only the automatic migrations
inside one transaction, records the migrations, verifies the login columns,
and creates the initial admin with
bcrypt. The password is never logged or put in source. A failed step rolls
back. Do not use it for a partially initialized database; reconcile that
schema separately. Remove the one-time approval and password environment
values after a successful run. No bootstrap command is run by image build or
API startup.

Build the API image from the repository root:

```sh
docker build -t sbms-api .
```

The image exposes port 5000 and honours the injected `PORT`. Deployment is manual: the image is pushed to `ghcr.io/eggxellent/sbms-api:<commit-sha>` (by `.github/workflows/publish-api-image.yml` or a local `docker build`/`docker push`, see `docs/azure-deployment-plan-2026-10-30.md` §12.11), then rolled into the Container App with `az containerapp update --image`. `DATABASE_URL`, `JWT_SECRET` and `SBMS_EXPECTED_DATABASE_NAME` are Container App secrets/env vars; nothing provisions or migrates a database automatically. Confirm the hosted database's status, backups, schema, and migration history before supplying its URL. Do not enter production credentials until the target has been approved. The existing migration runner is guarded for local loopback test databases and is not a production migration mechanism. The explicit empty-database bootstrap above is not automatic and must not be used on a database with existing objects or unverified data.

Neither Azure service deploys from a git push: the image tag and the frontend zip are chosen explicitly by the operator, so a pushed commit is live only after `az containerapp update --image` and a new App Service zip deploy. Confirm the image tag, `minReplicas`/cost settings, and the frontend origin before deploying. The API container is about 2.07 GiB; confirm the Container Apps consumption limits and cold-start budget for it (`minReplicas 0` pays interpreter and model load on the first request after idle).

The API service is public because it serves the authenticated API. The frontend build contains only the API origin; the model artifact remains in the API image and outside the App Service's published `dist` payload. App Service F1 serves the static build with a SPA rewrite so client routes resolve; see `docs/azure-deployment-log-2026-10-31.md` §1 and §7 for the deployed configuration.
