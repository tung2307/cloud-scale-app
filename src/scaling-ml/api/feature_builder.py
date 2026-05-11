import pandas as pd
from typing import List, Dict

BASE_COLS = [
    "requests",
    "response_time_ms",
    "node_cpu_millicores",
    "pod_cpu_millicores",
    "pod_mem_mi",
    "replicas",
]
LAGS = [1, 2, 3, 6, 12]
ROLL_WINDOW = 12  # 12 samples × 5s each = 60s


def build_features(history: List[Dict], feature_names: List[str]) -> pd.DataFrame:
    """
    Build the 179-feature input row from a window of recent metric samples.
    """
    df = pd.DataFrame(history).copy()

    # Ensure all base columns exist
    for col in BASE_COLS:
        if col not in df.columns:
            df[col] = 0.0

    # Build all new columns in dicts, then merge at the end (avoids fragmentation)
    new_cols: Dict[str, pd.Series] = {}

    # Lag features
    for col in BASE_COLS:
        for lag in LAGS:
            new_cols[f"{col}_lag{lag}"] = df[col].shift(lag)

    # Merge lags into df first
    if new_cols:
        df = pd.concat([df, pd.DataFrame(new_cols, index=df.index)], axis=1)

    # Rolling 60s stats for ALL columns
    roll_cols: Dict[str, pd.Series] = {}
    for col in list(df.columns):
        s = df[col]
        roll_cols[f"{col}_roll60s_mean"] = s.rolling(ROLL_WINDOW, min_periods=1).mean()
        roll_cols[f"{col}_roll60s_std"] = s.rolling(ROLL_WINDOW, min_periods=1).std().fillna(0)
        roll_cols[f"{col}_roll60s_min"] = s.rolling(ROLL_WINDOW, min_periods=1).min()
        roll_cols[f"{col}_roll60s_max"] = s.rolling(ROLL_WINDOW, min_periods=1).max()

    df = pd.concat([df, pd.DataFrame(roll_cols, index=df.index)], axis=1)

    # Take the most recent row and align to model's exact feature order
    last = df.iloc[[-1]].reindex(columns=feature_names, fill_value=0.0)
    return last