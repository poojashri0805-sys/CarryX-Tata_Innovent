
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent

FILES = {
    "features": ROOT / "data" / "table3_ml_features.csv",
    "ground_truth": ROOT / "data" / "trip_ground_truth.csv",
}

for name, path in FILES.items():
    print("\n" + "=" * 65)
    print(f"{name.upper()} DATASET")
    print("=" * 65)

    df = pd.read_csv(path)

    print("Shape:", df.shape)
    print("\nColumns:")
    for column in df.columns:
        print(f"  {column}")

    # Display columns potentially related to zones and residual mass.
    relevant = [
        column for column in df.columns
        if any(
            term in column.lower()
            for term in (
                "zone", "residual", "carryback",
                "severity", "weight", "trip_id"
            )
        )
    ]

    print("\nRelevant columns:")
    print(relevant)

    if relevant:
        print("\nSample values:")
        print(df[relevant].head(5).to_string(index=False))

        for column in relevant:
            if "zone" in column.lower():
                print(f"\nValue counts for {column}:")
                print(df[column].value_counts(dropna=False).head(15))

print("\nInspection complete.")
