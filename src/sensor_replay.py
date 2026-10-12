
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parent.parent
RAW_DATA_PATH = ROOT / "data" / "table2_raw_sensor_data.csv"


class SensorReplayService:
    def __init__(self):
        if not RAW_DATA_PATH.exists():
            raise FileNotFoundError(
                f"Raw sensor dataset not found: {RAW_DATA_PATH}"
            )

        print("Loading sensor replay dataset...")
        self.data = pd.read_csv(RAW_DATA_PATH)

        # Preserve the original row order within each trip.
        self.trips = {
            str(trip_id): group.reset_index(drop=True)
            for trip_id, group in self.data.groupby(
                "trip_id", sort=False
            )
        }

        print(f"Loaded {len(self.data):,} sensor records.")
        print(f"Available trips: {len(self.trips)}")

    def list_trips(self):
        return sorted(self.trips.keys())

    def get_trip_summary(self, trip_id: str):
        trip_id = str(trip_id)

        if trip_id not in self.trips:
            raise ValueError(f"Unknown trip ID: {trip_id}")

        df = self.trips[trip_id]

        return {
            "trip_id": trip_id,
            "truck_id": str(df.iloc[0]["truck_id"]),
            "total_records": len(df),
            "phase_counts": {
                str(phase): int(count)
                for phase, count in df["phase"]
                .value_counts(sort=False)
                .items()
            },
        }

    def get_records(
        self,
        trip_id: str,
        offset: int = 0,
        limit: int = 20,
    ):
        trip_id = str(trip_id)

        if trip_id not in self.trips:
            raise ValueError(f"Unknown trip ID: {trip_id}")

        if offset < 0:
            raise ValueError("Offset cannot be negative")

        if limit < 1 or limit > 200:
            raise ValueError("Limit must be between 1 and 200")

        df = self.trips[trip_id]
        batch = df.iloc[offset:offset + limit]

        records = batch.to_dict(orient="records")

        return {
            "trip_id": trip_id,
            "offset": offset,
            "returned": len(records),
            "total_records": len(df),
            "next_offset": offset + len(records),
            "complete": offset + len(records) >= len(df),
            "records": records,
        }
