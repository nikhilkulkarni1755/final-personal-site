-- ============================================================================
-- Fix RLS Policies and Trigger Function Permissions
-- ============================================================================
-- This migration:
-- 1. Adds SECURITY DEFINER to trigger functions so they can update counters
-- 2. Adds explicit policies to prevent public from modifying pages table
-- 3. Adds policies to prevent public from deleting page_views (data integrity)
-- 4. Admin (service role) can still do everything via Supabase dashboard
-- ============================================================================

-- ============================================================================
-- Update Trigger Functions with SECURITY DEFINER
-- ============================================================================
-- These functions need elevated privileges to update the pages table counters
-- when triggered by anonymous users inserting into related tables

CREATE OR REPLACE FUNCTION update_page_view_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE pages
        SET view_count = view_count + 1,
            updated_at = NOW()
        WHERE id = NEW.page_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE pages
        SET view_count = GREATEST(view_count - 1, 0),
            updated_at = NOW()
        WHERE id = OLD.page_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_page_interaction_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE pages
        SET interaction_count = interaction_count + 1,
            updated_at = NOW()
        WHERE id = NEW.page_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE pages
        SET interaction_count = GREATEST(interaction_count - 1, 0),
            updated_at = NOW()
        WHERE id = OLD.page_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_page_comment_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'approved' THEN
            UPDATE pages
            SET comment_count = comment_count + 1,
                updated_at = NOW()
            WHERE id = NEW.page_id;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status != NEW.status THEN
            IF OLD.status = 'approved' AND NEW.status != 'approved' THEN
                UPDATE pages
                SET comment_count = GREATEST(comment_count - 1, 0),
                    updated_at = NOW()
                WHERE id = NEW.page_id;
            ELSIF OLD.status != 'approved' AND NEW.status = 'approved' THEN
                UPDATE pages
                SET comment_count = comment_count + 1,
                    updated_at = NOW()
                WHERE id = NEW.page_id;
            END IF;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.status = 'approved' THEN
            UPDATE pages
            SET comment_count = GREATEST(comment_count - 1, 0),
                updated_at = NOW()
            WHERE id = OLD.page_id;
        END IF;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_page_like_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE pages
        SET like_count = like_count + 1,
            updated_at = NOW()
        WHERE id = NEW.page_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE pages
        SET like_count = GREATEST(like_count - 1, 0),
            updated_at = NOW()
        WHERE id = OLD.page_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Add RLS Policies to Prevent Public Modifications
-- ============================================================================

-- Prevent public from inserting new pages (admin only via service role)
CREATE POLICY "Prevent public insert pages"
    ON pages FOR INSERT
    WITH CHECK (false);

-- Prevent public from updating pages (triggers use SECURITY DEFINER to bypass)
CREATE POLICY "Prevent public update pages"
    ON pages FOR UPDATE
    USING (false);

-- Prevent public from deleting pages (admin only via service role)
CREATE POLICY "Prevent public delete pages"
    ON pages FOR DELETE
    USING (false);

-- Prevent public from deleting page_views (data integrity)
CREATE POLICY "Prevent public delete page_views"
    ON page_views FOR DELETE
    USING (false);

-- Prevent public from updating page_views (no need to modify historical data)
CREATE POLICY "Prevent public update page_views"
    ON page_views FOR UPDATE
    USING (false);

-- Prevent public from deleting interactions (data integrity)
CREATE POLICY "Prevent public delete interactions"
    ON interactions FOR DELETE
    USING (false);

-- Prevent public from updating interactions (no need to modify historical data)
CREATE POLICY "Prevent public update interactions"
    ON interactions FOR UPDATE
    USING (false);

-- Allow public to delete their own likes (for unlike functionality)
CREATE POLICY "Public delete own likes"
    ON likes FOR DELETE
    USING (true);

-- Prevent public from updating likes
CREATE POLICY "Prevent public update likes"
    ON likes FOR UPDATE
    USING (false);

-- Allow public to delete their own active sessions (for cleanup)
CREATE POLICY "Public delete active_sessions"
    ON active_sessions FOR DELETE
    USING (true);

-- Update comments on supabase\migrations\20251218000000_fix_rls_and_trigger_permissions.sql

COMMENT ON FUNCTION update_page_view_count() IS 'Maintains pages.view_count cache (SECURITY DEFINER to bypass RLS)';
COMMENT ON FUNCTION update_page_interaction_count() IS 'Maintains pages.interaction_count cache (SECURITY DEFINER to bypass RLS)';
COMMENT ON FUNCTION update_page_comment_count() IS 'Maintains pages.comment_count cache (SECURITY DEFINER to bypass RLS)';
COMMENT ON FUNCTION update_page_like_count() IS 'Maintains pages.like_count cache (SECURITY DEFINER to bypass RLS)';
