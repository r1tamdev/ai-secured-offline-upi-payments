import axios from 'axios';

const FRAUD_SERVICE_URL = process.env.FRAUD_SERVICE_URL || 'http://localhost:8001';

export async function checkFraud(txn) {
  try {
    const response = await axios.post(`${FRAUD_SERVICE_URL}/score`, txn,{
      timeout: 5000
    });
    return response.data;
  } catch (err) {
    console.error('Error checking fraud:', err.message);
    return { isAnomalous: false, anomalyScore: null, topContributingFeatures: [] }; // Default to no fraud if the service is unreachable
  }
}