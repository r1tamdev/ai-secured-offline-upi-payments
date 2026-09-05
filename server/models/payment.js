import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    packetHash: { type: String, required: true, unique: true },
    nonce:      { type: String, required: true },
    sender:     { type: String, required: true },
    receiver:   { type: String, required: true },
    amount:     { type: Number, required: true },
    note:       { type: String, default: '' },
    signedAt:   { type: Number, required: true },
    status:     { type: String, enum: ['SETTLED', 'FAILED', 'DUPLICATE'], default: 'SETTLED' },
    failReason: { type: String, default: null },
    settledAt:  { type: Date, default: Date.now },
    relayedBy:  { type: String, default: 'anonymous' },
  },
  { timestamps: true }
);

const Payment = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);

export default Payment;