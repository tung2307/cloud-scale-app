from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
from typing import List, Dict, Literal
import joblib

from feature_builder import build_features

app = FastAPI(title="Predictive Autoscaling API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

rf_model = joblib.load(MODELS_DIR / "random_forest.joblib")
xgb_model = joblib.load(MODELS_DIR / "xgboost.joblib")

# Assumes both models were trained with same features.
FEATURE_NAMES = list(xgb_model.feature_names_in_)


class PredictRequest(BaseModel):
    history: List[Dict]
    model: Literal["xgboost", "random_forest"] = "xgboost"


@app.get("/health")
def health():
    return {
        "status": "ok",
        "features_expected": len(FEATURE_NAMES),
        "min_history_required": 13,
        "models": ["xgboost", "random_forest"],
    }


@app.post("/predict")
def predict(req: PredictRequest):
    if len(req.history) < 13:
        return {
            "error": f"Need at least 13 history samples, got {len(req.history)}"
        }

    X = build_features(req.history, FEATURE_NAMES)

    model = xgb_model if req.model == "xgboost" else rf_model
    pred = float(model.predict(X)[0])

    recommended = int(max(1, min(5, round(pred))))

    return {
        "predicted_replicas_raw": round(pred, 3),
        "recommended_replicas": recommended,
        "model_used": req.model,
    }


@app.post("/predict/compare")
def predict_compare(req: PredictRequest):
    if len(req.history) < 13:
        return {
            "error": f"Need at least 13 history samples, got {len(req.history)}"
        }

    X = build_features(req.history, FEATURE_NAMES)

    xgb_pred = float(xgb_model.predict(X)[0])
    rf_pred = float(rf_model.predict(X)[0])

    return {
        "xgboost": {
            "predicted_replicas_raw": round(xgb_pred, 3),
            "recommended_replicas": int(max(1, min(5, round(xgb_pred)))),
        },
        "random_forest": {
            "predicted_replicas_raw": round(rf_pred, 3),
            "recommended_replicas": int(max(1, min(5, round(rf_pred)))),
        },
    }