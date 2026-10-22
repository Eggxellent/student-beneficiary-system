# Optional ML comparison experiments

These comparison scripts are separate from the standard training workflow. The default input is `ml-service/training/realistic_pairs_train.csv`; the six pair features and `group_id` are read directly. Generate that dataset first by running `ml-service/train.py`. `data/raw_pairs.csv` is a separate, harder synthetic scenario dataset, documented in `data/raw_pairs_metadata.json`; standard training does not use it. Reports and plots from earlier synthetic runs were removed because they do not describe the current application model.

Run from the repository root on Windows:

```powershell
& '.\ml-service\.venv\Scripts\python.exe' '.\ml-service\experiments\run_research_comparisons.py'
```

Install the shared ML dependencies from `ml-service/requirements.txt` when setting up a fresh environment.

The comparison results are generated under `ml-service/experiments/results/`. They remain simulations and should not be represented as real-case performance. Standard application training is performed by `ml-service/train.py` and records its grouped holdout and metrics under `ml-service/evaluation/`.
