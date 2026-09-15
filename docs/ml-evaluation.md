# ML Duplicate Detection Evaluation

## 1. Model

The Student Beneficiary Management System uses a Random Forest Classifier to determine the probability that two student records represent the same beneficiary.

The model uses four features:

1. Jaro-Winkler name similarity
2. Date of birth match
3. School code match
4. Guardian ID match

## 2. Dataset

The synthetic dataset contains approximately 10,000 labelled student pairs.

The data was divided using a stratified 80/20 train-test split.

- Training samples: 8,000
- Testing samples: 2,000
- Class 0: Non-duplicate
- Class 1: Duplicate

The dataset contains both duplicate and non-duplicate examples.

## 3. Model Training

A Random Forest Classifier was trained using 5-fold stratified cross-validation.

Hyperparameters were tuned using GridSearchCV.

### Best Parameters

- `n_estimators`: 100
- `max_depth`: 4
- `max_features`: sqrt
- `min_samples_leaf`: 2

### Best Cross-Validation F1

**1.00**

## 4. Evaluation Results

The model achieved the following results on the test dataset:

| Metric | Score |
|---|---:|
| Accuracy | 1.00 |
| Precision | 1.00 |
| Recall | 1.00 |
| F1 Score | 1.00 |
| AUC-ROC | 1.00 |

## 5. Confusion Matrix

```text
[[1000    0]
 [   0 1000]]
```

This means:

- 1,000 non-duplicates were correctly classified.
- 1,000 duplicates were correctly classified.
- No false positives occurred in the test set.
- No false negatives occurred in the test set.

## 6. Overfitting Check

The training F1 score was:

**1.00**

The cross-validation F1 score was:

**1.00**

Therefore:

**Train/CV F1 gap = 0.00**

This indicates that there was no observed performance gap between the training and cross-validation results.

However, because the dataset is synthetic, these results should not be interpreted as proof that the model will achieve 100% accuracy on real-world student records. Real-world validation data should be used before deployment in an operational environment.

## 7. Model Serialization

The trained model was serialized using Joblib and saved as:

```text
ml-service/model/rf_duplicate_model.joblib
```

The saved model is loaded by `predict.py` to generate duplicate probabilities.

## 8. Conclusion

The Random Forest duplicate detection model successfully completed training, hyperparameter tuning, evaluation, and serialization.

The model achieved perfect performance on the current synthetic test dataset, with an F1 score and AUC-ROC of 1.00.

The model is therefore ready for integration testing with the Node.js backend.

## 9. Performance Test

The duplicate detection prediction pipeline was tested using the trained Random Forest model.

The test measures the time required for the Node.js backend to invoke the Python prediction service and receive the duplicate probability.

### Performance Requirement

Target: **less than 3 seconds per duplicate prediction.**

### Result

Measured prediction time: **55.84 ms**

Result: **PASS**

The measured prediction time was below the required 3-second threshold in the local test environment.