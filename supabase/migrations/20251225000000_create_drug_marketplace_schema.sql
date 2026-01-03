-- ============================================================================
-- Drug Marketplace Simulation Schema
-- ============================================================================
-- This migration creates a complete drug marketplace simulation system for
-- a voice agent interface. Includes drug inventory, user token balances,
-- and purchase transaction tracking.
--
-- NOTE: No RLS policies are applied - all operations are publicly accessible
-- for this demo/simulation environment.
-- ============================================================================

-- ============================================================================
-- TABLE: drugs
-- ============================================================================
-- Central table storing all available drugs in the marketplace
-- ============================================================================

CREATE TABLE drugs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    stock INTEGER NOT NULL CHECK (stock >= 0),
    diseases_treated TEXT[] NOT NULL DEFAULT '{}',
    side_effects TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE drugs IS 'Marketplace drug inventory with prices, stock, and medical information';
COMMENT ON COLUMN drugs.name IS 'Unique drug name (case-insensitive searches supported)';
COMMENT ON COLUMN drugs.price IS 'Price in tokens (integer)';
COMMENT ON COLUMN drugs.stock IS 'Current stock quantity available';
COMMENT ON COLUMN drugs.diseases_treated IS 'Array of diseases/conditions this drug treats';
COMMENT ON COLUMN drugs.side_effects IS 'Array of potential side effects';

-- ============================================================================
-- TABLE: marketplace_users
-- ============================================================================
-- Tracks user token balances using visitor fingerprinting
-- Integrates with existing analytics system via visitor_id
-- ============================================================================

CREATE TABLE marketplace_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL UNIQUE,
    token_balance INTEGER NOT NULL DEFAULT 100 CHECK (token_balance >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE marketplace_users IS 'User accounts with token balances for marketplace purchases';
COMMENT ON COLUMN marketplace_users.user_id IS 'Hashed visitor ID from browser fingerprinting (matches analytics system)';
COMMENT ON COLUMN marketplace_users.token_balance IS 'Current token balance (starts at 100, no regeneration)';

-- ============================================================================
-- TABLE: purchases
-- ============================================================================
-- Records all drug purchases made by users
-- ============================================================================

CREATE TABLE purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    total_cost INTEGER NOT NULL CHECK (total_cost >= 0),
    purchase_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE purchases IS 'Purchase history for all drug transactions';
COMMENT ON COLUMN purchases.user_id IS 'User ID from marketplace_users (no FK for flexibility)';
COMMENT ON COLUMN purchases.drug_id IS 'Reference to purchased drug';
COMMENT ON COLUMN purchases.quantity IS 'Number of units purchased';
COMMENT ON COLUMN purchases.total_cost IS 'Total cost in tokens for this purchase';

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Performance indexes for common query patterns
-- ============================================================================

-- Drugs indexes
CREATE INDEX idx_drugs_name ON drugs(name);
CREATE INDEX idx_drugs_price ON drugs(price);
CREATE INDEX idx_drugs_stock ON drugs(stock);
CREATE INDEX idx_drugs_created_at ON drugs(created_at DESC);

-- Marketplace users indexes
CREATE INDEX idx_marketplace_users_user_id ON marketplace_users(user_id);
CREATE INDEX idx_marketplace_users_created_at ON marketplace_users(created_at DESC);

-- Purchases indexes
CREATE INDEX idx_purchases_user_id ON purchases(user_id);
CREATE INDEX idx_purchases_drug_id ON purchases(drug_id);
CREATE INDEX idx_purchases_date ON purchases(purchase_date DESC);
CREATE INDEX idx_purchases_user_date ON purchases(user_id, purchase_date DESC);

-- ============================================================================
-- TRIGGER FUNCTIONS: Auto-update timestamp
-- ============================================================================
-- Automatically update the updated_at column when rows are modified
-- ============================================================================

-- Create or replace the update_updated_at_column function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to drugs table
CREATE TRIGGER trigger_drugs_updated_at
    BEFORE UPDATE ON drugs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to marketplace_users table
CREATE TRIGGER trigger_marketplace_users_updated_at
    BEFORE UPDATE ON marketplace_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- INITIAL DATA SEED
-- ============================================================================
-- Populate marketplace with 4 drugs at varying price points
-- Prices: 5, 20, 50, 75 tokens (allows experimentation within 100-token budget)
-- ============================================================================

INSERT INTO drugs (name, description, price, stock, diseases_treated, side_effects) VALUES
    (
        'PainAway',
        'Multi-spectrum analgesic and anti-inflammatory medication designed for comprehensive pain management. Effective for both chronic and acute pain conditions.',
        5,
        250,
        ARRAY['pain', 'inflammation', 'chronic pain', 'acute pain'],
        ARRAY['stomach upset', 'dizziness', 'fatigue']
    ),
    (
        'MindEase',
        'A powerful anxiolytic and antidepressant medication designed to restore emotional balance and mental clarity. Helps manage anxiety disorders and depression.',
        20,
        250,
        ARRAY['anxiety', 'depression', 'stress', 'panic disorder'],
        ARRAY['drowsiness', 'nausea', 'headache']
    ),
    (
        'CogniFocus',
        'Advanced cognitive enhancement medication for improved focus, attention, and mental performance. Particularly effective for ADHD and concentration difficulties.',
        50,
        250,
        ARRAY['ADHD', 'concentration issues', 'attention deficit', 'focus problems'],
        ARRAY['insomnia', 'appetite loss', 'jitters']
    ),
    (
        'ImmuneBoost',
        'Immunomodulatory medication to strengthen and support immune system function. Helps prevent frequent infections and supports overall immune health.',
        75,
        250,
        ARRAY['immune deficiency', 'frequent infections', 'weak immune system'],
        ARRAY['fever', 'rash', 'muscle aches']
    );

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

COMMENT ON TABLE drugs IS 'Drug marketplace schema created successfully. 4 drugs seeded with prices: 5, 20, 50, 75 tokens. Ready for voice agent integration.';
