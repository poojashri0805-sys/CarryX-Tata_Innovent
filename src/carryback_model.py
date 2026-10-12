import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import GroupShuffleSplit
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "table3_ml_features.csv"
MODEL_PATH = ROOT / "models" / "carryback_model.pkl"
MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)

print(f"Loading feature dataset from: {DATA_PATH}")
df = pd.read_csv(DATA_PATH)

y = df["carryback_label"]

exclude_columns = [
    "trip_id",
    "truck_id",
    "material_type",
    "post_unload_weight_kg",
    "residual_weight_kg",
    "actual_residual_mass_kg",
    "actual_residual_zone",
    "carryback_label",
    "severity",
    "stickiness_index",
    "recommended_action",
]

X = df.drop(columns=exclude_columns)
X = pd.get_dummies(X, drop_first=True)

print("X shape:", X.shape)
print("y shape:", y.shape)
print("\nTarget distribution:")
print(y.value_counts())

splitter = GroupShuffleSplit(
    n_splits=1,
    test_size=0.20,
    random_state=42,
)
train_idx, test_idx = next(splitter.split(X, y, groups=df["truck_id"]))

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

model = RandomForestClassifier(
    n_estimators=250,
    random_state=42,
    class_weight="balanced",
    min_samples_leaf=2,
)
model.fit(X_train, y_train)

print("\nRandom Forest training completed!")

y_pred = model.predict(X_test)
accuracy = accuracy_score(y_test, y_pred)
precision = precision_score(y_test, y_pred, zero_division=0)
recall = recall_score(y_test, y_pred, zero_division=0)
f1 = f1_score(y_test, y_pred, zero_division=0)

print("\n--- Model Performance ---")
print(f"Accuracy  : {accuracy:.4f}")
print(f"Precision : {precision:.4f}")
print(f"Recall    : {recall:.4f}")
print(f"F1 Score  : {f1:.4f}")
print("\nClassification Report:")
print(classification_report(y_test, y_pred, zero_division=0))

importance = pd.Series(model.feature_importances_, index=X.columns).sort_values(ascending=False)
print("\nTop 15 Important Features:")
print(importance.head(15))

cm = confusion_matrix(y_test, y_pred)
print("\nConfusion Matrix:")
print(cm)

joblib.dump(model, MODEL_PATH)
print(f"\nModel saved as {MODEL_PATH}")
