# CARRYX

CARRYX is a synthetic-data prototype for mining dump-truck carryback detection. It replays a simulated haul cycle, compares empty-bed and post-unload sensor behavior, predicts carryback, highlights affected zones, and recommends an operational response.

## Project layout

- `src/`: dataset generation, sensor replay, API, and model code
- `data/`: generated trip, sensor, feature, and evaluation data
- `models/`: trained carryback model
- `frontend/`: React and Vite operator dashboard

## Run the backend

```powershell
.venv\Scripts\Activate.ps1
python -m uvicorn src.main:app --reload
```

## Run the frontend

```powershell
cd frontend
npm install
npm run dev
```

The backend runs at `http://127.0.0.1:8000` and the frontend runs at the Vite URL shown in the terminal.

## Data note

The dataset is synthetic and is intended to demonstrate the end-to-end workflow. Real-world deployment requires calibration and validation with labeled truck sensor data. The raw sensor CSV is tracked with Git LFS because it is larger than GitHub's normal file limit.
