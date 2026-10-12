import pandas as pd

# Load Table 3
df = pd.read_csv("table3_ml_features.csv")

print("Dataset shape:", df.shape)
print("\nZone distribution:")
print(df["actual_residual_zone"].value_counts().sort_index())
# Target
y = df["actual_residual_zone"]

# Remove target / non-feature columns
exclude_columns = [
    "trip_id",
    "truck_id",
    "material_type",
    "actual_residual_mass_kg",
    "actual_residual_zone",
    "carryback_label",
    "severity",
    "post_unload_weight_kg",
    "residual_weight_kg"
]

X = df.drop(columns=exclude_columns)

# Convert categorical columns if any
X = pd.get_dummies(X, drop_first=True)

print("\nX shape:", X.shape)
print("y shape:", y.shape)
from sklearn.model_selection import GroupShuffleSplit

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
from sklearn.ensemble import RandomForestClassifier

# Create model
zone_model = RandomForestClassifier(
    n_estimators=200,
    random_state=42,
    class_weight=None
)

# Train
zone_model.fit(X_train, y_train)

print("\nZone Random Forest training completed!")
from sklearn.metrics import accuracy_score, f1_score, classification_report

# Make predictions
y_pred = zone_model.predict(X_test)

# Evaluation
accuracy = accuracy_score(y_test, y_pred)
macro_f1 = f1_score(y_test, y_pred, average="macro")

print("\n--- Zone Prediction Performance ---")
print(f"Accuracy : {accuracy:.4f}")
print(f"Macro F1 : {macro_f1:.4f}")

print("\nClassification Report:")
print(classification_report(y_test, y_pred))
importance = pd.Series(
    zone_model.feature_importances_,
    index=X.columns
).sort_values(ascending=False)

print("\nTop 15 Zone Features:")
print(importance.head(15))