// ============================================================================
// Peripheral Agentic OS — Attribution Type Definitions
// ============================================================================

/** Attribution layer types */
export type AttributionLayer = 'visible' | 'hmac' | 'steganographic' | 'blockchain';

/** Visible credit line */
export interface VisibleCredit {
  text: string;
  model: string;
  provider: string;
  timestamp: string;
  taskId: string;
}

/** HMAC signature */
export interface HMACSignature {
  algorithm: 'sha256';
  signature: string;
  keyId: string;
  contentHash: string;
  timestamp: string;
}

/** Steganographic watermark */
export interface SteganographicWatermark {
  encoded: boolean;
  payload: string;       // Base64 encoded metadata
  method: 'zero_width';  // Zero-width Unicode characters
  markerCount: number;
}

/** Blockchain timestamp */
export interface BlockchainTimestamp {
  hash: string;
  protocol: 'opentimestamps';
  anchor: 'bitcoin';
  status: 'pending' | 'confirmed';
  proof?: string;
  confirmedAt?: string;
}

/** Complete attribution record */
export interface AttributionRecord {
  id: string;
  taskId: string;
  contentHash: string;
  layers: {
    visible?: VisibleCredit;
    hmac?: HMACSignature;
    steganographic?: SteganographicWatermark;
    blockchain?: BlockchainTimestamp;
  };
  createdAt: string;
}

/** Attribution verification result */
export interface AttributionVerification {
  valid: boolean;
  layersVerified: AttributionLayer[];
  layersFailed: AttributionLayer[];
  tamperDetected: boolean;
  details: string;
}
