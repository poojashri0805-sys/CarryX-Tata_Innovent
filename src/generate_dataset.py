import csv
import math
import random
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ============================================================
# CONFIGURATION
# ============================================================

NUM_TRUCKS = 10
TRIPS_PER_TRUCK = 100
TOTAL_TRIPS = NUM_TRUCKS * TRIPS_PER_TRUCK

SAMPLE_RATE = 100          # 100 Hz
TRIP_DURATION_SEC = 10     # 10 seconds per trip
TOTAL_SAMPLES = SAMPLE_RATE * TRIP_DURATION_SEC

EMPTY_WEIGHT = 2.0         # kg
PAYLOAD_VALUES = [2.0, 3.0, 4.0, 5.0]
RESIDUAL_VALUES = [0.0, 0.5, 1.0, 1.5, 2.0]

MATERIALS = ["clay", "coal", "iron_ore", "limestone"]

OUTPUT_TABLE1 = DATA_DIR / "table1_trip_information.csv"
OUTPUT_TABLE2 = DATA_DIR / "table2_raw_sensor_data.csv"
OUTPUT_GT = DATA_DIR / "trip_ground_truth.csv"

random.seed(42)


# ============================================================
# MATERIAL CHARACTERISTICS
# ============================================================

MATERIAL_FACTOR = {
    "clay": 1.25,
    "coal": 0.90,
    "iron_ore": 1.05,
    "limestone": 0.75
}

MATERIAL_PROPERTIES = {
    "clay": {
        "stickiness": 0.82,
        "cohesion": 0.88,
        "moisture_bias": 0.72,
    },
    "coal": {
        "stickiness": 0.54,
        "cohesion": 0.60,
        "moisture_bias": 0.48,
    },
    "iron_ore": {
        "stickiness": 0.90,
        "cohesion": 0.96,
        "moisture_bias": 0.85,
    },
    "limestone": {
        "stickiness": 0.62,
        "cohesion": 0.66,
        "moisture_bias": 0.53,
    },
}

# ============================================================
# SENSOR COLUMNS
# ============================================================

RAW_COLUMNS = [
    "trip_id",
    "truck_id",
    "timestamp",
    "phase",

    "weight_kg",

    "accel_x_g",
    "accel_y_g",
    "accel_z_g",

    "gyro_x_dps",
    "gyro_y_dps",
    "gyro_z_dps",

    "zone1_acc_x",
    "zone1_acc_y",
    "zone1_acc_z",

    "zone2_acc_x",
    "zone2_acc_y",
    "zone2_acc_z",

    "zone3_acc_x",
    "zone3_acc_y",
    "zone3_acc_z",

    "zone4_acc_x",
    "zone4_acc_y",
    "zone4_acc_z",

    "zone5_acc_x",
    "zone5_acc_y",
    "zone5_acc_z"
]


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def clamp(value, low, high):
    return max(low, min(high, value))


def smooth_noise(previous, strength):
    """
    Creates correlated noise instead of completely random noise.
    """
    return 0.85 * previous + random.gauss(0, strength)


def acceleration_signal(t, phase, material_factor, affected_zone,
                        zone, truck_factor):

    # Base vibration
    base = (
        0.018 * math.sin(2 * math.pi * 2.0 * t)
        + 0.010 * math.sin(2 * math.pi * 5.0 * t)
    )

    # Phase-dependent vibration
    if phase == "empty":
        vibration = 0.015

    elif phase == "loading":
        vibration = 0.045

    elif phase == "loaded":
        vibration = 0.030

    elif phase == "unloading":
        vibration = 0.085

    else:
        vibration = 0.018

    vibration *= material_factor
    vibration *= truck_factor

    # Zone-to-zone correlation
    correlated = vibration * (
        0.65
        + 0.20 * math.sin(2 * math.pi * 1.2 * t + zone)
    )

    # Carry-back spatial effect
    if affected_zone == zone and phase == "unloading":
        correlated *= 1.45

    elif abs(affected_zone - zone) == 1 and phase == "unloading":
        correlated *= 1.15

    # Small variation between zones
    correlated += random.gauss(0, 0.008)

    return base + correlated


def generate_trip_weight(
    elapsed,
    payload,
    residual,
    phase,
    material
):

    loaded_weight = EMPTY_WEIGHT + payload
    post_weight = EMPTY_WEIGHT + residual

    if phase == "empty":
        weight = EMPTY_WEIGHT

    elif phase == "loading":
        # Smooth loading
        progress = elapsed / 3.0
        progress = clamp(progress, 0, 1)

        weight = (
            EMPTY_WEIGHT
            + payload * progress
            + random.gauss(0, 0.015)
        )

    elif phase == "loaded":
        weight = loaded_weight + random.gauss(0, 0.015)

    elif phase == "unloading":
        # Material leaves the bed.
        progress = (elapsed - 4.0) / 2.0
        progress = clamp(progress, 0, 1)

        discharged = payload - residual
        weight = (
            loaded_weight
            - discharged * progress
            + random.gauss(0, 0.020)
        )

    else:
        # Post-unload state
        weight = post_weight + random.gauss(0, 0.010)

    return max(weight, EMPTY_WEIGHT - 0.05)


def get_phase(t):
    """
    10-second trip:
    0-1 sec   -> empty
    1-4 sec   -> loading
    4-5 sec   -> loaded
    5-8 sec   -> unloading
    8-10 sec  -> post_unload
    """

    if t < 1:
        return "empty"

    elif t < 4:
        return "loading"

    elif t < 5:
        return "loaded"

    elif t < 8:
        return "unloading"

    else:
        return "post_unload"


def get_tilt(t, phase, dump_angle):

    if phase != "unloading":
        return random.gauss(0, 0.8)

    progress = clamp((t - 5.0) / 3.0, 0, 1)

    # Smooth dump-bed lifting
    return (
        dump_angle * math.sin(math.pi * progress)
        + random.gauss(0, 0.5)
    )


# ============================================================
# REALISTIC CARRY-BACK DISTRIBUTION
# ============================================================

def clamp(value, low, high):
    return max(low, min(high, value))


def compute_stickiness(material, payload, dump_angle_deg, moisture_level):
    props = MATERIAL_PROPERTIES[material]
    angle_factor = clamp((70.0 - dump_angle_deg) / 30.0, 0.0, 1.0)
    payload_factor = clamp(payload / 5.0, 0.2, 1.5)
    moisture_factor = clamp(moisture_level, 0.0, 1.0)

    stickiness = (
        props["stickiness"]
        + props["cohesion"] * 0.35
        + angle_factor * 0.20
        + moisture_factor * 0.25
        + (payload_factor - 1.0) * 0.10
    )

    return clamp(stickiness, 0.0, 1.0)


def determine_severity(residual_mass, stickiness_index):
    risk_score = (residual_mass / 1.8) + (stickiness_index * 2.2)

    if residual_mass <= 0.0:
        return "none"
    if risk_score < 1.4:
        return "low"
    if risk_score < 2.6:
        return "medium"
    if risk_score < 4.0:
        return "high"
    return "critical"


def recommended_action(residual_mass, stickiness_index, zone_count):
    score = residual_mass * (0.65 + stickiness_index) + zone_count * 0.35

    if score < 0.7:
        return "monitor_only"
    if score < 2.2:
        return "inspect_and_clean_soon"
    if score < 4.2:
        return "clean_before_next_cycle"
    return "immediate_cleaning_required"


def generate_carryback_condition():
    material = random.choice(MATERIALS)
    payload = random.choice(PAYLOAD_VALUES)
    dump_angle = random.uniform(55.0, 70.0)
    moisture_level = random.uniform(0.2, 0.9)

    no_carryback = random.random() < 0.28
    if no_carryback:
        return {
            "material": material,
            "payload": payload,
            "dump_angle_deg": dump_angle,
            "moisture_level": moisture_level,
            "residual_mass_kg": 0.0,
            "affected_zone": 0,
            "stickiness_index": 0.0,
            "recommended_action": "monitor_only",
            "severity": "none",
        }

    affected_zone = random.randint(1, 5)
    retention_factor = 0.10 + MATERIAL_PROPERTIES[material]["stickiness"] * 0.38
    dump_factor = clamp((70.0 - dump_angle) / 30.0, 0.0, 1.0)
    payload_factor = clamp(payload / 5.0, 0.5, 1.3)

    residual_mass = (
        payload * retention_factor * (0.55 + dump_factor * 0.85) * payload_factor
        * random.uniform(0.7, 1.25)
    )

    residual_mass = round(clamp(residual_mass, 0.15, 3.2), 2)

    stickiness = compute_stickiness(
        material,
        payload,
        dump_angle,
        moisture_level,
    )

    severity = determine_severity(residual_mass, stickiness)
    action = recommended_action(residual_mass, stickiness, 1)

    return {
        "material": material,
        "payload": payload,
        "dump_angle_deg": dump_angle,
        "moisture_level": moisture_level,
        "residual_mass_kg": residual_mass,
        "affected_zone": affected_zone,
        "stickiness_index": round(stickiness, 3),
        "recommended_action": action,
        "severity": severity,
    }


carryback_conditions = [generate_carryback_condition() for _ in range(TOTAL_TRIPS)]
random.shuffle(carryback_conditions)

assert len(carryback_conditions) == TOTAL_TRIPS


# ============================================================
# FILE CREATION
# ============================================================

with open(OUTPUT_TABLE1, "w", newline="") as f1, \
     open(OUTPUT_TABLE2, "w", newline="") as f2, \
     open(OUTPUT_GT, "w", newline="") as fgt:

    trip_writer = csv.writer(f1)
    raw_writer = csv.writer(f2)
    gt_writer = csv.writer(fgt)

    # --------------------------------------------------------
    # TABLE 1
    # --------------------------------------------------------

    trip_writer.writerow([
        "trip_id",
        "truck_id",
        "material_type",
        "payload_kg",
        "loading_start_time",
        "unloading_start_time",
        "unloading_end_time",
        "unloading_duration_sec",
        "dump_angle_deg"
    ])

    # --------------------------------------------------------
    # TABLE 2
    # --------------------------------------------------------

    raw_writer.writerow(RAW_COLUMNS)

    # --------------------------------------------------------
    # GROUND TRUTH
    # --------------------------------------------------------

    gt_writer.writerow([
        "trip_id",
        "truck_id",
        "actual_residual_mass_kg",
        "actual_residual_zone",
        "carryback_label",
        "severity",
        "stickiness_index",
        "recommended_action"
    ])

    trip_counter = 0

    start_datetime = datetime(2026, 1, 1, 8, 0, 0)

    # ========================================================
    # GENERATE TRIPS
    # ========================================================

    for truck_number in range(1, NUM_TRUCKS + 1):

        truck_id = f"TRUCK_{truck_number:02d}"

        # Small permanent variation for each truck
        truck_factor = random.uniform(0.85, 1.15)

        for trip_number in range(1, TRIPS_PER_TRUCK + 1):

            trip_counter += 1

            trip_id = f"TRIP_{trip_counter:04d}"

            condition = carryback_conditions[trip_counter - 1]
            material = condition["material"]
            payload = condition["payload"]
            residual = condition["residual_mass_kg"]
            affected_zone = condition["affected_zone"]
            stickiness_index = condition["stickiness_index"]
            recommended_action_label = condition["recommended_action"]

            loaded_weight = EMPTY_WEIGHT + payload
            post_unload_weight = EMPTY_WEIGHT + residual

            dump_angle = condition["dump_angle_deg"]

            trip_start = (
                start_datetime
                + timedelta(minutes=(trip_counter - 1) * 2)
            )

            loading_start = trip_start

            unloading_start = (
                trip_start + timedelta(seconds=5)
            )

            unloading_end = (
                trip_start + timedelta(seconds=8)
            )

            trip_writer.writerow([
                trip_id,
                truck_id,
                material,
                round(payload, 2),
                loading_start.strftime("%Y-%m-%d %H:%M:%S"),
                unloading_start.strftime("%Y-%m-%d %H:%M:%S"),
                unloading_end.strftime("%Y-%m-%d %H:%M:%S"),
                3,
                round(dump_angle, 2)
            ])

            # ------------------------------------------------
            # SENSOR NOISE STATE
            # ------------------------------------------------

            noise_x = 0
            noise_y = 0
            noise_z = 0

            # ------------------------------------------------
            # 100 Hz SENSOR DATA
            # ------------------------------------------------

            for sample in range(TOTAL_SAMPLES):

                t = sample / SAMPLE_RATE

                timestamp = (
                    trip_start
                    + timedelta(seconds=t)
                )

                phase = get_phase(t)

                # --------------------------------------------
                # WEIGHT
                # --------------------------------------------

                weight = generate_trip_weight(
                    t,
                    payload,
                    residual,
                    phase,
                    material
                )

                # --------------------------------------------
                # MPU9250 ACCELEROMETER
                # --------------------------------------------

                material_factor = MATERIAL_FACTOR[material]

                noise_x = smooth_noise(noise_x, 0.002)
                noise_y = smooth_noise(noise_y, 0.002)
                noise_z = smooth_noise(noise_z, 0.002)

                accel_x = (
                    0.015
                    * math.sin(2 * math.pi * 1.5 * t)
                    + noise_x
                )

                accel_y = (
                    0.020
                    * math.sin(2 * math.pi * 1.8 * t + 1)
                    + noise_y
                )

                accel_z = (
                    1.0
                    + 0.025
                    * math.sin(2 * math.pi * 2.2 * t)
                    + noise_z
                )

                # More motion during unloading
                if phase == "unloading":
                    accel_x += random.gauss(0, 0.025)
                    accel_y += random.gauss(0, 0.030)
                    accel_z += random.gauss(0, 0.040)

                # --------------------------------------------
                # MPU9250 GYROSCOPE
                # --------------------------------------------

                if phase == "unloading":

                    progress = clamp(
                        (t - 5.0) / 3.0,
                        0,
                        1
                    )

                    gyro_x = (
                        dump_angle
                        * 0.25
                        * math.cos(math.pi * progress)
                        + random.gauss(0, 0.8)
                    )

                    gyro_y = (
                        2.0
                        * math.sin(2 * math.pi * progress)
                        + random.gauss(0, 0.7)
                    )

                    gyro_z = random.gauss(0, 0.8)

                else:

                    gyro_x = random.gauss(0, 0.25)
                    gyro_y = random.gauss(0, 0.25)
                    gyro_z = random.gauss(0, 0.25)

                # --------------------------------------------
                # FIVE ADXL355 ZONES
                # --------------------------------------------

                zone_values = []

                for zone in range(1, 6):

                    zx = acceleration_signal(
                        t,
                        phase,
                        material_factor,
                        affected_zone,
                        zone,
                        truck_factor
                    )

                    zy = (
                        0.75 * zx
                        + 0.012
                        * math.sin(
                            2 * math.pi * 3.0 * t
                            + zone
                        )
                        + random.gauss(0, 0.006)
                    )

                    zz = (
                        1.0
                        + 0.45 * zx
                        + random.gauss(0, 0.008)
                    )

                    # Stronger residual-zone effect
                    if (
                        affected_zone == zone
                        and residual > 0
                        and phase == "post_unload"
                    ):
                        zx += 0.020
                        zy += 0.015
                        zz += 0.010

                    zone_values.extend([
                        round(zx, 6),
                        round(zy, 6),
                        round(zz, 6)
                    ])

                # --------------------------------------------
                # WRITE RAW ROW
                # --------------------------------------------

                raw_writer.writerow([
                    trip_id,
                    truck_id,
                    timestamp.strftime(
                        "%Y-%m-%d %H:%M:%S.%f"
                    ),

                    phase,

                    round(weight, 4),

                    round(accel_x, 6),
                    round(accel_y, 6),
                    round(accel_z, 6),

                    round(gyro_x, 6),
                    round(gyro_y, 6),
                    round(gyro_z, 6),

                    *zone_values
                ])

            # ------------------------------------------------
            # GROUND TRUTH
            # ------------------------------------------------

            carryback_label = 1 if residual > 0 else 0
            severity = condition["severity"]

            gt_writer.writerow([
                trip_id,
                truck_id,
                round(residual, 2),
                affected_zone if affected_zone != 0 else "none",
                carryback_label,
                severity,
                stickiness_index,
                recommended_action_label
            ])

            # Progress
            if trip_counter % 50 == 0:
                print(
                    f"Generated {trip_counter}/{TOTAL_TRIPS} trips..."
                )

# ============================================================
# FEATURE TABLE GENERATION
# ============================================================

raw_df = pd.read_csv(OUTPUT_TABLE2)
trip_info = pd.read_csv(OUTPUT_TABLE1)
ground_truth = pd.read_csv(OUTPUT_GT)

raw_df["trip_id"] = raw_df["trip_id"].astype(str)
raw_df["phase"] = raw_df["phase"].astype(str).str.strip().str.lower()

feature_rows = []

for trip_id, trip_df in raw_df.groupby("trip_id", sort=False):
    trip_meta = trip_info[trip_info["trip_id"] == trip_id].iloc[0]
    gt_row = ground_truth[ground_truth["trip_id"] == trip_id].iloc[0]
    phase_groups = trip_df.groupby("phase", sort=False)

    empty_weight = (
        float(phase_groups.get_group("empty")["weight_kg"].mean())
        if "empty" in phase_groups.groups
        else 2.0
    )
    loaded_weight = (
        float(phase_groups.get_group("loaded")["weight_kg"].mean())
        if "loaded" in phase_groups.groups
        else float(trip_meta["payload_kg"]) + EMPTY_WEIGHT
    )
    post_unload_weight = (
        float(phase_groups.get_group("post_unload")["weight_kg"].mean())
        if "post_unload" in phase_groups.groups
        else EMPTY_WEIGHT + float(gt_row["actual_residual_mass_kg"])
    )

    unloading_df = phase_groups.get_group("unloading") if "unloading" in phase_groups.groups else trip_df
    unload_gyro = float(unloading_df["gyro_y_dps"].mean()) if len(unloading_df) else 0.0
    unload_tilt = float(unloading_df["gyro_x_dps"].mean()) if len(unloading_df) else 0.0

    row = {
        "trip_id": str(trip_id),
        "truck_id": str(trip_meta["truck_id"]),
        "material_type": str(trip_meta["material_type"]),
        "payload_kg": float(trip_meta["payload_kg"]),
        "dump_angle_deg": float(trip_meta["dump_angle_deg"]),
        "unloading_duration_sec": int(trip_meta["unloading_duration_sec"]),
        "empty_weight_kg": round(empty_weight, 4),
        "loaded_weight_kg": round(loaded_weight, 4),
        "post_unload_weight_kg": round(post_unload_weight, 4),
        "residual_weight_kg": round(post_unload_weight - empty_weight, 4),
        "tilt_angle_deg": round(float(gt_row["actual_residual_mass_kg"]) * 0.75 + float(trip_meta["dump_angle_deg"]) * 0.15, 4),
        "angular_velocity_dps": round(unload_gyro, 4),
        "filtered_tilt_angle_deg": round(unload_tilt, 4),
        "bed_state": "post_unload",
    }

    for zone in range(1, 6):
        zone_cols = [f"zone{zone}_acc_x", f"zone{zone}_acc_y", f"zone{zone}_acc_z"]
        zone_array = trip_df[zone_cols].to_numpy(dtype=float)
        acc_magnitude = np.linalg.norm(zone_array, axis=1)

        if len(acc_magnitude) == 0:
            row[f"zone{zone}_mean"] = 0.0
            row[f"zone{zone}_rms"] = 0.0
            row[f"zone{zone}_std"] = 0.0
            row[f"zone{zone}_variance"] = 0.0
            row[f"zone{zone}_peak"] = 0.0
            row[f"zone{zone}_peak_to_peak"] = 0.0
            row[f"zone{zone}_kurtosis"] = 0.0
            row[f"zone{zone}_skewness"] = 0.0
            row[f"zone{zone}_energy"] = 0.0
            row[f"zone{zone}_acceleration_magnitude"] = 0.0
            continue

        row[f"zone{zone}_mean"] = float(acc_magnitude.mean())
        row[f"zone{zone}_rms"] = float(np.sqrt(np.mean(acc_magnitude ** 2)))
        row[f"zone{zone}_std"] = float(acc_magnitude.std(ddof=0))
        row[f"zone{zone}_variance"] = float(acc_magnitude.var(ddof=0))
        row[f"zone{zone}_peak"] = float(acc_magnitude.max())
        row[f"zone{zone}_peak_to_peak"] = float(acc_magnitude.max() - acc_magnitude.min())
        row[f"zone{zone}_kurtosis"] = float(pd.Series(acc_magnitude).kurtosis()) if len(acc_magnitude) > 3 else 0.0
        row[f"zone{zone}_skewness"] = float(pd.Series(acc_magnitude).skew()) if len(acc_magnitude) > 2 else 0.0
        row[f"zone{zone}_energy"] = float(np.sum(acc_magnitude ** 2))
        row[f"zone{zone}_acceleration_magnitude"] = float(acc_magnitude.mean())

    row["actual_residual_mass_kg"] = float(gt_row["actual_residual_mass_kg"])
    row["actual_residual_zone"] = gt_row["actual_residual_zone"]
    row["carryback_label"] = int(gt_row["carryback_label"])
    row["severity"] = str(gt_row["severity"])
    row["stickiness_index"] = float(gt_row["stickiness_index"])
    row["recommended_action"] = str(gt_row["recommended_action"])

    feature_rows.append(row)

features_df = pd.DataFrame(feature_rows).sort_values("trip_id").reset_index(drop=True)
features_df.to_csv(DATA_DIR / "table3_ml_features.csv", index=False)

# ============================================================
# FINISHED
# ============================================================

print("\n==============================================")
print("DATASET GENERATION COMPLETED")
print("==============================================")
print(f"Total trucks : {NUM_TRUCKS}")
print(f"Trips/truck  : {TRIPS_PER_TRUCK}")
print(f"Total trips  : {TOTAL_TRIPS}")
print(f"Sampling     : {SAMPLE_RATE} Hz")
print(f"Samples/trip : {TOTAL_SAMPLES}")
print("")
print("Files created:")
print(f"1. {OUTPUT_TABLE1}")
print(f"2. {OUTPUT_TABLE2}")
print(f"3. {OUTPUT_GT}")
print("==============================================")