# Deployment blockers

Before deploying SBMS publicly, resolve these items:

1. Public registration currently accepts a client-supplied role. Restrict public registration to `field_officer` or disable public registration and provision administrators securely.
2. `ml-service/predict.py` loads `ml-service/model/rf_duplicate_model.joblib`, but that production model file is absent. The available `model/research/rf_attachment_style_candidate.joblib` is a research candidate evaluated only on synthetic data and must not be silently promoted.
3. `backend/src/services/duplicateCheck.js` uses Windows-only `.venv/Scripts/python.exe` paths. Configure a cross-platform Python executable and ensure the runtime dependencies are installed.
4. Configure the API to serve the built frontend or configure a production API URL; the Vite proxy is development-only.
5. Apply and verify the database schema against the Render PostgreSQL instance before enabling production traffic. Never commit database credentials or JWT secrets.
6. Run backend tests and a deployment smoke test before making the service public.

No live student data should be used for testing without appropriate authorization. Duplicate flags must remain subject to human review.
