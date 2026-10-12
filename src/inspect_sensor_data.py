
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW_PATH = ROOT / "data" / "table2_raw_sensor_data.csv"

print("Loading raw sensor data...")
df = pd.read_csv(RAW_PATH)

print("\nTotal records:", len(df))
print("Total columns:", len(df.columns))
print("Unique trips:", df["trip_id"].nunique())
print("Unique trucks:", df["truck_id"].nunique())

print("\nRecords per phase:")
print(df["phase"].value_counts(dropna=False))

print("\nRecords per trip — summary:")
counts = df.groupby("trip_id").size()
print(counts.describe())

trip_id = "TRIP_0001"
trip = df[df["trip_id"] == trip_id]

print(f"\n{trip_id} record count:", len(trip))

if not trip.empty:
    print("\nPhase counts for this trip:")
    print(trip["phase"].value_counts(dropna=False))

    print("\nFirst 10 sensor records:")
    print(trip.head(10).to_string(index=False))

    print("\nLast 5 sensor records:")
    print(trip.tail(5).to_string(index=False))

print("\nSensor data inspection completed.")
