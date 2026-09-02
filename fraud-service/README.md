# UPI Offline Mesh — Fraud Scoring Service

Unsupervised anomaly detection (Isolation Forest) that scores transactions
at the relay/settlement gateway before they're committed. Runs as a
standalone FastAPI service alongside the existing MERN backend.

## Why this design
- No labeled fraud data exists for a personal project, so this is
  **unsupervised** (Isolation Forest), not classification.
- Scoring happens at the **relay/gateway**, not on offline devices —
  consistent with the DTN-inspired architecture where offline nodes
  can't run heavy inference.
- Fails **open**: if the scoring service is down, transactions still
  settle normally (logged loudly) rather than blocking legitimate payments.
- Includes a heuristic explainability layer since Isolation Forest gives
  an anomaly score but no built-in per-feature attribution.

## Setup (Windows cmd)

```cmd
cd fraud-service
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Edit `.env` and set `MONGO_URI` to your existing MongoDB Atlas connection
string (same DB used by the MERN backend, or a separate `upi_mesh` DB —
your call).

## 1. Seed synthetic data (for demo/training, since no real fraud data exists)

```cmd
python seed_synthetic.py
```

## 2. Train the model

```cmd
python train.py
```

Re-run this periodically (cron job / Windows Task Scheduler) as more
real transaction data accumulates.

## 3. Run the scoring service

```cmd
uvicorn main:app --reload --port 8001
```

Test it:

```cmd
curl -X POST http://localhost:8001/score -H "Content-Type: application/json" -d "{\"senderId\":\"sender_1\",\"receiverId\":\"receiver_5\",\"amount\":4500,\"timestamp\":\"2026-08-30T10:15:00Z\",\"relayDelaySeconds\":1.2,\"packetSizeBytes\":512}"
```

## 4. Wire into the Node relay

Copy `relayIntegration.js` into your MERN backend (e.g.
`services/fraudCheck.js`) and call `checkFraud()` right before
settlement — see the commented example at the bottom of that file.

Add to your Node backend's `.env`:
```
FRAUD_SERVICE_URL=http://localhost:8001
```

## Tuning
- `CONTAMINATION` in `.env` — expected fraud rate in training data (start at 0.02)
- `FLAG_THRESHOLD` — anomaly score cutoff; tune based on false-positive rate in your `pending_review` collection

## Talking points for interviews
- Unsupervised because no labeled data; Isolation Forest handles
  high-dimensional data without distributional assumptions and trains fast
- Precision/recall tradeoff explicitly considered: fails open to avoid
  blocking legitimate offline payments on false positives
- Feature set is derivable entirely from existing packet metadata —
  no new instrumentation required on offline devices
- Explainability layer bridges the gap between a black-box anomaly
  score and an actionable "why was this flagged"
