
from pathlib import Path

import joblib
import pandas as pd


ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / "models" / "carryback_model.pkl"
FEATURES_PATH = ROOT / "data" / "table3_ml_features.csv"

EXCLUDED_COLUMNS = [
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


class CarrybackPredictionService:
    def __init__(self):
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Model not found: {MODEL_PATH}")

        if not FEATURES_PATH.exists():
            raise FileNotFoundError(
                f"Feature dataset not found: {FEATURES_PATH}"
            )

        self.model = joblib.load(MODEL_PATH)
        self.data = pd.read_csv(FEATURES_PATH)

        self.feature_names = list(self.model.feature_names_in_)

        # Reconstruct the same feature preparation used during training.
        raw_features = self.data.drop(columns=EXCLUDED_COLUMNS)
        self.features = pd.get_dummies(
            raw_features, drop_first=True
        )

        missing = [
            name for name in self.feature_names
            if name not in self.features.columns
        ]

        extra = [
            name for name in self.features.columns
            if name not in self.feature_names
        ]

        if missing or extra:
            raise ValueError(
                f"Feature mismatch. Missing={missing}; Extra={extra}"
            )

        # Enforce the saved model's original feature order.
        self.features = self.features[self.feature_names]

        self.trip_indices = {
            str(trip_id): index
            for index, trip_id in enumerate(self.data["trip_id"])
        }

    def predict_trip(self, trip_id: str) -> dict:
        trip_id = str(trip_id)

        if trip_id not in self.trip_indices:
            raise ValueError(f"Unknown trip ID: {trip_id}")

        index = self.trip_indices[trip_id]
        row = self.data.iloc[index]
        X = self.features.iloc[[index]]

        prediction = int(self.model.predict(X)[0])

        probabilities = self.model.predict_proba(X)[0]
        classes = list(self.model.classes_)
        carryback_probability = (
            float(probabilities[classes.index(1)])
            if 1 in classes else 0.0
        )

        return {
            "trip_id": trip_id,
            "truck_id": str(row["truck_id"]),
            "prediction": prediction,
            "prediction_label": (
                "Carry-back detected"
                if prediction == 1
                else "No carry-back detected"
            ),
            "carryback_probability": round(
                carryback_probability, 4
            ),
            "dump_angle_deg": float(row["dump_angle_deg"]),
            "unloading_duration_sec": int(
                row["unloading_duration_sec"]
            ),
        }


if __name__ == "__main__":
    service = CarrybackPredictionService()

    result = service.predict_trip("TRIP_0001")

    print("\nCARRYX prediction test")
    for key, value in result.items():
        print(f"{key}: {value}")
