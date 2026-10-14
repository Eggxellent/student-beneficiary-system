# ML Duplicate Detection Evaluation

## 1. Model

The Student Beneficiary Management System uses a Random Forest Classifier to determine the probability that two student records represent the same beneficiary.

The model uses six features:

1. Jaro-Winkler name similarity
2. Date of birth match
3. School code match
4. Guardian ID match
5. UPI match
6. Birth certificate entry number match

## 2. Dataset

The synthetic dataset contains 10,000 labelled student pairs.

The data was divided using a grouped, stratified 80/20 train-test split so generated identity groups do not cross the split boundary.

- Training samples: 8,000
- Testing samples: 2,000
- Class 0: Non-duplicate
- Class 1: Duplicate

The dataset contains both duplicate and non-duplicate examples.

## 3. Model Training

A Random Forest Classifier was trained using 5-fold stratified cross-validation.

Hyperparameters were tuned using GridSearchCV.

### Best Parameters

- `n_estimators`: 150
- `max_depth`: 6
- `max_features`: sqrt
- `min_samples_leaf`: 10

### Best Cross-Validation F1

**0.9887**

## 4. Evaluation Results

The model achieved the following results on the test dataset:

| Metric | Score |
|---|---:|
| Accuracy | 0.989 |
| Precision | 0.99 |
| Recall | 0.99 |
| F1 Score | 0.99 |
| AUC-ROC | 0.9985 |

## 5. Confusion Matrix

```text
[[986  14]
 [  8 992]]
```

This means:

- 986 non-duplicates were correctly classified.
- 992 duplicates were correctly classified.
- 14 false positives occurred in the test set.
- 8 false negatives occurred in the test set.

## 6. Overfitting Check

The training F1 score was:

**0.9890**

The cross-validation F1 score was:

**0.9887**

Therefore:

**Train/CV F1 gap = 0.0003**

This indicates that there was no meaningful observed performance gap between the training and cross-validation results.

However, because the dataset is synthetic, these results should not be interpreted as proof that the model will achieve 100% accuracy on real-world student records. Real-world validation data should be used before deployment in an operational environment.

## 7. Model Serialization

The trained model was serialized using Joblib and saved as:

```text
ml-service/model/rf_duplicate_model.joblib
```

The saved model is loaded by `predict.py` to generate duplicate probabilities.

## 8. Conclusion

The Random Forest duplicate detection model successfully completed training, hyperparameter tuning, evaluation, and serialization.

The model achieved an F1 score of approximately 0.99 and an AUC-ROC of 0.9985 on the current six-feature synthetic test dataset.

The model is therefore ready for integration testing with the Node.js backend.

## 9. Performance Test

The duplicate detection prediction pipeline was tested using the trained Random Forest model.

The test measures the time required for the Node.js backend to invoke the Python prediction service and receive the duplicate probability.

### Performance Requirement

Target: **less than 3 seconds per duplicate prediction.**

### Result

Measured prediction time: **39.77 ms**

Result: **PASS**

The measured prediction time was below the required 3-second threshold in the local test environment.

## 10. Random Forest vs XGBoost

Both models were evaluated on the same six-feature dataset and the same stratified test split.

| Model | Accuracy | Precision | Recall | F1 | AUC-ROC | Prediction time |
|---|---:|---:|---:|---:|---:|---:|
| Random Forest | 0.9890 | 0.9861 | 0.9920 | 0.9890 | 0.9985 | 105.72 ms |
| XGBoost | 0.9880 | 0.9851 | 0.9910 | 0.9880 | 0.9986 | 8.57 ms |

Random Forest remains the selected baseline because it produced the slightly better accuracy and F1 score in this experiment. XGBoost is a viable alternative with comparable AUC and lower measured prediction time, but the difference does not justify replacing the current baseline without further validation on real records.

## 11. Feature Ablation Study

Each experiment used the same Random Forest configuration, dataset, and test split while removing one feature at a time.

| Feature set | F1 | AUC-ROC |
|---|---:|---:|
| All six features | 0.9890 | 0.9985 |
| Without name similarity | 0.9797 | 0.9976 |
| Without DOB | 0.9861 | 0.9981 |
| Without school | 0.9871 | 0.9984 |
| Without guardian | 0.9832 | 0.9979 |
| Without UPI | 0.9837 | 0.9959 |
| Without birth certificate | 0.9460 | 0.9901 |

The birth certificate comparison produced the largest performance change in this synthetic dataset. This supports retaining it as a high-weight feature. Operationally, exact UPI and birth-certificate matches each contribute 40% of the score; a score of 70% or higher is labelled Duplicate, while lower matches remain for admin review. Admin confirmation is required, and real-world validation remains necessary.

## 12. Name Similarity Comparison

Jaro-Winkler and Levenshtein similarity were evaluated with the same Random Forest configuration, six supporting features, dataset, and test split.

| Name feature | F1 | AUC-ROC |
|---|---:|---:|
| Jaro-Winkler | 0.9890 | 0.9985 |
| Levenshtein similarity | 0.9895 | 0.9985 |

Levenshtein produced a marginally higher F1 score, but both methods had the same AUC. Jaro-Winkler remains the application default because the difference is negligible on synthetic data and it is already integrated into the live comparison pipeline.