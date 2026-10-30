# SBMS API container

The repository `Dockerfile` builds the SBMS API and its Python duplicate predictor in one image. The build copies the tracked production artifact to `/app/ml-service/model/xgb_duplicate_model.joblib` and loads it during the image build to fail early if the artifact or its Python dependencies are invalid. `.dockerignore` excludes the research experiment and all other joblib artifacts; the research model is never a substitute.

The Node API invokes `ml-service/predict.py` as a child process. The image sets `PYTHON_EXECUTABLE` to its virtual-environment interpreter. Outside the image, the backend checks that setting first, then the platform-appropriate Python virtual-environment paths.

The API image does not contain or serve the frontend. Keep model artifacts out of any frontend/static-site publish directory. The frontend defaults to the relative `/api` path locally; `VITE_API_ORIGIN` can point it at a separate API origin for production. The root `render.yaml` is a prepared Render Blueprint for the Docker API and static frontend. It wires the frontend's Render URL into the API origin and CORS allowlist, and provides the SPA fallback route.

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

The image exposes port 5000 and honors Render's injected `PORT`. The Blueprint prompts for `DATABASE_URL` (`sync: false`) and asks Render to generate `JWT_SECRET`; it does not provision or migrate a database. Confirm the existing hosted database's status, backups, schema, and migration history before supplying its URL. Do not enter production credentials until the target has been approved. The existing migration runner is guarded for local loopback test databases and is not a production migration mechanism. The explicit empty-database bootstrap above is not automatic and must not be used on a database with existing objects or unverified data.

Both services set `autoDeployTrigger: off`. Applying this Blueprint can create/deploy services, so do not sync it until the database target, service plans/costs, deployment branch, and service names are confirmed. The API container is about 2.07 GiB; confirm Render build/storage and runtime limits for the selected plan. No Blueprint validation, sync, database connection, or deployment has been performed as part of this preparation.

The API service is public because it serves the authenticated API. The frontend build contains only the API origin; the model artifact remains in the API image and outside the static site's `dist` publish path. Render's Blueprint supports Docker and static services, service-referenced environment variables, and SPA rewrite rules; see the [Blueprint YAML reference](https://render.com/docs/blueprint-spec) and [redirects and rewrites documentation](https://render.com/docs/redirects-rewrites).
