# SBMS API container

The repository `Dockerfile` builds the SBMS API and its Python duplicate predictor in one image. The build copies the tracked production artifact to `/app/ml-service/model/xgb_duplicate_model.joblib` and loads it during the image build to fail early if the artifact or its Python dependencies are invalid. `.dockerignore` excludes the research experiment and all other joblib artifacts; the research model is never a substitute.

The Node API invokes `ml-service/predict.py` as a child process. The image sets `PYTHON_EXECUTABLE` to its virtual-environment interpreter. Outside the image, the backend checks that setting first, then the platform-appropriate Python virtual-environment paths.

The API image does not contain or serve the frontend. Keep model artifacts out of any frontend/static-site publish directory. The frontend defaults to the relative `/api` path locally; `VITE_API_ORIGIN` can point it at a separate API origin for production. The root `render.yaml` is a prepared Render Blueprint for the Docker API and static frontend. It wires the frontend's Render URL into the API origin and CORS allowlist, and provides the SPA fallback route.

Build the API image from the repository root:

```sh
docker build -t sbms-api .
```

The image exposes port 5000 and honors Render's injected `PORT`. The Blueprint prompts for `DATABASE_URL` (`sync: false`) and asks Render to generate `JWT_SECRET`; it does not provision or migrate a database. Confirm the existing hosted database's status, backups, schema, and migration history before supplying its URL. Do not enter production credentials until the target has been approved. The database schema migration remains a separate authorized operation and is not run by the image build or startup.

Both services set `autoDeployTrigger: off`. Applying this Blueprint can create/deploy services, so do not sync it until the database target, service plans/costs, deployment branch, and service names are confirmed. The API container is about 2.07 GiB; confirm Render build/storage and runtime limits for the selected plan. No Blueprint validation, sync, database connection, or deployment has been performed as part of this preparation.

The API service is public because it serves the authenticated API. The frontend build contains only the API origin; the model artifact remains in the API image and outside the static site's `dist` publish path. Render's Blueprint supports Docker and static services, service-referenced environment variables, and SPA rewrite rules; see the [Blueprint YAML reference](https://render.com/docs/blueprint-spec) and [redirects and rewrites documentation](https://render.com/docs/redirects-rewrites).
