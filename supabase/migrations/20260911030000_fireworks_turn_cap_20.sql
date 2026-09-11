-- Twenty model turns per run, up from twelve. A one-line fix takes four
-- turns; a feature that spans three files was hitting the cap while still
-- exploring. The browser and the gateway carry the same number.
CREATE OR REPLACE FUNCTION enforce_fireworks_turn_cap()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.turn > 20 THEN
        RAISE EXCEPTION 'turn cap reached for this run'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
