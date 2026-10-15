# Reproduce the SBMS comparisons

These are the reportable comparison runs for the capstone. They use the checked-in `ml-service/data/features.csv`, a group-separated 80/20 holdout (seed 42), and five-fold grouped cross-validation. The Random Forest and XGBoost searches each check 24 candidates. The name-method run reuses the Random Forest settings selected by the first comparison.

From the repository root on Windows, run:

```powershell
& '.\ml-service\.venv\Scripts\python.exe' '.\ml-service\experiments\run_research_comparisons.py'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\ml-service\experiments\render_comparison_report.ps1'
```

If the virtual environment is missing, create one with Python 3.11 and install the experiment dependencies:

```powershell
py -3.11 -m venv ml-service\.venv
& '.\ml-service\.venv\Scripts\python.exe' -m pip install -r ml-service\experiments\requirements.txt
```

Outputs are written under `ml-service/experiments/results/`:

- `comparison_results.json` contains the full metrics, split details, installed package information, selected parameters, and dataset hash.
- `comparison_report.md` contains the result tables and conclusions.
- `comparison_report.png` is a one-page screenshot-ready table for the capstone report.

The existing `compare_models.py` and `compare_name_similarity.py` files are earlier exploratory scripts. Use the runner above when reporting controlled comparison results. The experiment does not replace or modify the model artifact used by the application.
