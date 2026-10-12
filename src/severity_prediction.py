import pandas as pd
from sklearn.model_selection import GroupShuffleSplit
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    classification_report,
    confusion_matrix,
    ConfusionMatrixDisplay
)
import matplotlib.pyplot as plt


# ============================================================
# 1. LOAD TABLE 3
# ============================================================

df = pd.read_csv("table3_ml_features.csv")

print("Dataset shape:", df.shape)

print("\nSeverity distribution:")
print(df["severity"].value_counts())


# ============================================================
# 2. PREPARE INPUT FEATURES (X) AND TARGET (y)
# ============================================================

y = df["severity"]

# Columns that must NOT be used as ML inputs
exclude_columns = [
    "trip_id",
    "truck_id",
    "material_type",

    # Direct residual information
    "post_unload_weight_kg",
    "residual_weight_kg",
    "actual_residual_mass_kg",

    # Other target/output columns
    "actual_residual_zone",
    "carryback_label",
    "severity"
]

X = df.drop(columns=exclude_columns)

# Convert categorical columns if present
X = pd.get_dummies(X, drop_first=True)

print("\nX shape:", X.shape)
print("y shape:", y.shape)


# ============================================================
# 3. SPLIT BY TRUCK
# ============================================================

# Important:
# The model must be tested on trucks it has never seen.

splitter = GroupShuffleSplit(
    n_splits=1,
    test_size=0.20,
    random_state=42
)

train_idx, test_idx = next(
    splitter.split(X, y, groups=df["truck_id"])
)

X_train = X.iloc[train_idx]
X_test = X.iloc[test_idx]

y_train = y.iloc[train_idx]
y_test = y.iloc[test_idx]

print("\nTraining samples:", len(X_train))
print("Testing samples:", len(X_test))

print("\nTraining trucks:")
print(df.iloc[train_idx]["truck_id"].unique())

print("\nTesting trucks:")
print(df.iloc[test_idx]["truck_id"].unique())


# ============================================================
# 4. TRAIN RANDOM FOREST
# ============================================================

severity_model = RandomForestClassifier(
    n_estimators=200,
    random_state=42,
    class_weight="balanced"
)

severity_model.fit(X_train, y_train)

print("\nSeverity Random Forest training completed!")


# ============================================================
# 5. MAKE PREDICTIONS
# ============================================================

y_pred = severity_model.predict(X_test)


# ============================================================
# 6. MODEL PERFORMANCE
# ============================================================

accuracy = accuracy_score(y_test, y_pred)

precision = precision_score(
    y_test,
    y_pred,
    average="weighted",
    zero_division=0
)

recall = recall_score(
    y_test,
    y_pred,
    average="weighted",
    zero_division=0
)

f1 = f1_score(
    y_test,
    y_pred,
    average="weighted",
    zero_division=0
)

print("\n--- Severity Prediction Performance ---")
print(f"Accuracy  : {accuracy:.4f}")
print(f"Precision : {precision:.4f}")
print(f"Recall    : {recall:.4f}")
print(f"F1 Score  : {f1:.4f}")


# ============================================================
# 7. CLASSIFICATION REPORT
# ============================================================

print("\nClassification Report:")

print(
    classification_report(
        y_test,
        y_pred,
        zero_division=0
    )
)


# ============================================================
# 8. CONFUSION MATRIX
# ============================================================

cm = confusion_matrix(y_test, y_pred)

print("\nConfusion Matrix:")
print(cm)

ConfusionMatrixDisplay(
    confusion_matrix=cm
).plot()

plt.title("Severity Prediction - Confusion Matrix")
plt.tight_layout()
plt.show()


# ============================================================
# 9. FEATURE IMPORTANCE
# ============================================================

importance = pd.Series(
    severity_model.feature_importances_,
    index=X.columns
).sort_values(ascending=False)

print("\nTop 15 Important Features:")

print(importance.head(15))