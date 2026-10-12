
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from src.sensor_replay import SensorReplayService
from src.prediction_service import CarrybackPredictionService


app = FastAPI(
    title="CARRYX API",
    description="Mining dump-truck carry-back detection simulation",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROOT = Path(__file__).resolve().parent.parent
GROUND_TRUTH_PATH = ROOT / "data" / "trip_ground_truth.csv"
RAW_SENSOR_PATH = ROOT / "data" / "table2_raw_sensor_data.csv"

# Reuse the existing prediction and replay services.
service = CarrybackPredictionService()
sensor_service = SensorReplayService()

# Ground truth is used only for final evaluation, never for zone scoring.
ground_truth = pd.read_csv(GROUND_TRUTH_PATH)
ground_truth["trip_id"] = ground_truth["trip_id"].astype(str)

# Load raw sensor data for phase comparisons.
raw_sensor_data = pd.read_csv(RAW_SENSOR_PATH)
raw_sensor_data["trip_id"] = raw_sensor_data["trip_id"].astype(str)
raw_sensor_data["phase"] = (
    raw_sensor_data["phase"].astype(str).str.lower().str.strip()
)

ZONE_NAMES = {
    1: "FRONT LEFT",
    2: "FRONT RIGHT",
    3: "CENTER MASS",
    4: "REAR LEFT",
    5: "REAR RIGHT",
}

ZONE_KEYS = {
    1: "front_left",
    2: "front_right",
    3: "center_mass",
    4: "rear_left",
    5: "rear_right",
}


@app.get("/")
def home():
    return {
        "application": "CARRYX",
        "status": "running",
        "message": "Carry-back detection API is ready",
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "model_loaded": True,
        "total_trips": len(service.data),
        "sensor_records": len(raw_sensor_data),
    }


@app.get("/trips")
def get_trips():
    columns = [
        "trip_id",
        "truck_id",
        "material_type",
        "payload_kg",
        "dump_angle_deg",
        "unloading_duration_sec",
    ]

    available = [c for c in columns if c in service.data.columns]

    return {
        "count": len(service.data),
        "trips": service.data[available].to_dict(orient="records"),
    }


@app.get("/predict/{trip_id}")
def predict_trip(trip_id: str):
    try:
        return service.predict_trip(trip_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/sensor-replay/{trip_id}/summary")
def sensor_summary(trip_id: str):
    try:
        return sensor_service.get_trip_summary(trip_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/sensor-replay/{trip_id}")
def sensor_replay(
    trip_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=200),
):
    try:
        return sensor_service.get_records(
            trip_id=trip_id,
            offset=offset,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/zone-risk/{trip_id}")
def get_zone_risk(trip_id: str):
    """
    Estimate relative sensor-change scores for five zones.

    Scores compare post-unload acceleration magnitude with the empty
    phase. They are experimental anomaly indicators, not calibrated
    carryback probabilities. Ground-truth labels are not used here.
    """
    trip = raw_sensor_data[
        raw_sensor_data["trip_id"] == str(trip_id)
    ]

    if trip.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No sensor records found for {trip_id}",
        )

    empty = trip[trip["phase"] == "empty"]
    post = trip[trip["phase"] == "post_unload"]

    if empty.empty or post.empty:
        raise HTTPException(
            status_code=422,
            detail=(
                "Both empty and post_unload records are required "
                "to calculate zone-risk scores."
            ),
        )

    zones = []

    for zone_id in range(1, 6):
        columns = [
            f"zone{zone_id}_acc_x",
            f"zone{zone_id}_acc_y",
            f"zone{zone_id}_acc_z",
        ]

        missing = [c for c in columns if c not in trip.columns]
        if missing:
            raise HTTPException(
                status_code=500,
                detail=f"Missing sensor columns: {missing}",
            )

        empty_xyz = empty[columns].to_numpy(dtype=float)
        post_xyz = post[columns].to_numpy(dtype=float)

        empty_magnitude = np.linalg.norm(empty_xyz, axis=1)
        post_magnitude = np.linalg.norm(post_xyz, axis=1)

        baseline_mean = float(np.mean(empty_magnitude))
        post_mean = float(np.mean(post_magnitude))
        change = post_mean - baseline_mean

        zones.append({
            "zone_id": zone_id,
            "key": ZONE_KEYS[zone_id],
            "name": ZONE_NAMES[zone_id],
            "baseline_mean_magnitude": round(baseline_mean, 6),
            "post_unload_mean_magnitude": round(post_mean, 6),
            "magnitude_change": round(change, 6),
        })

    # Normalize positive changes within this trip.
    max_change = max(
        (max(zone["magnitude_change"], 0.0) for zone in zones),
        default=0.0,
    )

    for zone in zones:
        score = (
            max(0.0, zone["magnitude_change"]) / max_change * 100.0
            if max_change > 0
            else 0.0
        )

        zone["risk_score"] = round(score, 1)
        zone["risk_level"] = (
            "high" if score >= 70
            else "moderate" if score >= 35
            else "low"
        )

    return {
        "trip_id": str(trip_id),
        "source": "raw_sensor_data",
        "score_type": "relative_sensor_change",
        "baseline_phase": "empty",
        "comparison_phase": "post_unload",
        "zones": zones,
        "warning": (
            "Relative sensor-change scores are experimental indicators. "
            "They are not calibrated carryback probabilities and do not "
            "prove that residual material exists in a zone."
        ),
    }


RESIDUAL_ALLOWED_LIMIT_KG = 0.25
SHORT_HOLD_SECONDS = 0.5
EXTENDED_HOLD_SECONDS = 1.5


def derive_recommended_action(
    residual_mass_kg: float | None,
    stickiness_index: float | None,
    dump_angle_deg: float | None = None,
    persistence_seconds: float = 0.0,
):
    mass = float(residual_mass_kg) if residual_mass_kg is not None else 0.0
    stickiness = float(stickiness_index) if stickiness_index is not None else 0.0
    angle = float(dump_angle_deg) if dump_angle_deg is not None else None
    tilt_instruction = (
        f" Increase toward the next validated tilt setpoint from {angle:.1f}°"
        if angle is not None
        else " Increase tilt only within the validated safe operating range"
    )

    if mass <= RESIDUAL_ALLOWED_LIMIT_KG:
        return {
            "action": "normal_completion",
            "label": "Normal completion",
            "message": (
                f"Residual weight is {mass:.2f} kg, below the validated "
                f"limit of {RESIDUAL_ALLOWED_LIMIT_KG:.2f} kg. Complete the unload."
            ),
        }

    if mass <= 0.75 and persistence_seconds < SHORT_HOLD_SECONDS:
        return {
            "action": "short_hold_and_recheck",
            "label": "Short hold and recheck",
            "message": (
                f"Residual indication is {mass:.2f} kg. Hold at the current safe tilt "
                f"for {SHORT_HOLD_SECONDS:.1f} seconds, then recheck residual weight."
            ),
        }

    if mass <= 1.5 and persistence_seconds < 1.5:
        return {
            "action": "extended_hold_and_recheck",
            "label": "Extended hold and recheck",
            "message": (
                f"Residual indication persisted for {persistence_seconds:.1f} seconds."
                f"{tilt_instruction} and hold for {EXTENDED_HOLD_SECONDS:.1f} seconds, "
                "then recheck residual weight."
            ),
        }

    return {
        "action": "manual_inspection",
        "label": "Manual inspection",
        "message": (
            f"Residual weight remains at {mass:.2f} kg, above the validated limit "
            f"of {RESIDUAL_ALLOWED_LIMIT_KG:.2f} kg after unloading. Stop the normal "
            "cycle and inspect the truck bed manually."
        ),
    }


@app.get("/zones/{trip_id}")
def get_trip_zones(trip_id: str):
    """Return recorded ground truth for evaluation only."""
    rows = ground_truth[ground_truth["trip_id"] == str(trip_id)]

    if rows.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No ground-truth record found for {trip_id}",
        )

    row = rows.iloc[0]
    raw_zone = str(row["actual_residual_zone"]).strip()
    active_zone = None if raw_zone.lower() == "none" else raw_zone

    try:
        residual_mass = float(row["actual_residual_mass_kg"])
    except (ValueError, TypeError):
        residual_mass = None

    try:
        stickiness_index = float(row["stickiness_index"])
    except (ValueError, TypeError):
        stickiness_index = None

    zone_id = int(active_zone) if active_zone in {"1", "2", "3", "4", "5"} else None
    trip_sensor_data = raw_sensor_data[raw_sensor_data["trip_id"] == str(trip_id)]
    empty_records = trip_sensor_data[trip_sensor_data["phase"] == "empty"]
    post_records = trip_sensor_data[trip_sensor_data["phase"] == "post_unload"]
    empty_weight = float(empty_records["weight_kg"].mean()) if not empty_records.empty else 0.0
    residual_weight = post_records["weight_kg"] - empty_weight
    persistence_seconds = float((residual_weight > RESIDUAL_ALLOWED_LIMIT_KG).sum() / 100.0)
    trip_info_row = service.data[service.data["trip_id"] == str(trip_id)]
    dump_angle = (
        float(trip_info_row.iloc[0]["dump_angle_deg"])
        if not trip_info_row.empty and "dump_angle_deg" in trip_info_row
        else None
    )
    action = derive_recommended_action(
        residual_mass,
        stickiness_index,
        dump_angle,
        persistence_seconds,
    )

    return {
        "trip_id": str(trip_id),
        "source": "simulated_ground_truth_for_evaluation",
        "actual_residual_zone": zone_id,
        "actual_residual_zone_name": (
            ZONE_NAMES[zone_id] if zone_id is not None else None
        ),
        "actual_residual_mass_kg": residual_mass,
        "carryback_label": int(row["carryback_label"]),
        "severity": str(row["severity"]),
        "stickiness_index": stickiness_index,
        "residual_allowed_limit_kg": RESIDUAL_ALLOWED_LIMIT_KG,
        "residual_persistence_seconds": round(persistence_seconds, 2),
        "recommended_action": action["label"],
        "recommended_action_detail": action["message"],
        "recommended_action_key": action["action"],
    }
