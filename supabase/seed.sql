-- ============================================================================
-- Seed Data for Analytics Schema
-- ============================================================================
-- Initial page records for the personal website
-- ============================================================================

-- Insert initial pages
INSERT INTO pages (slug, title, type, metadata) VALUES
    ('/', 'Home', 'home', '{"description": "Personal website home page"}'),
    ('/blog', 'Blog', 'blog_index', '{"description": "Blog posts index page"}'),
    ('/apps', 'Apps', 'apps', '{"description": "Showcase of personal apps and projects"}')
ON CONFLICT (slug) DO NOTHING;

-- Optional: Add some sample data for testing (remove in production)
-- Uncomment below if you want to test with sample data

/*
-- Get page IDs for sample data
DO $$
DECLARE
    home_page_id UUID;
    blog_page_id UUID;
    apps_page_id UUID;
BEGIN
    SELECT id INTO home_page_id FROM pages WHERE slug = '/';
    SELECT id INTO blog_page_id FROM pages WHERE slug = '/blog';
    SELECT id INTO apps_page_id FROM pages WHERE slug = '/apps';

    -- Sample page views
    INSERT INTO page_views (page_id, visitor_id, ip_hash, city, state, country, user_agent, referrer)
    VALUES
        (home_page_id, 'hash_visitor_1', 'hash_ip_1', 'San Francisco', 'CA', 'USA', 'Mozilla/5.0...', NULL),
        (home_page_id, 'hash_visitor_2', 'hash_ip_2', 'New York', 'NY', 'USA', 'Mozilla/5.0...', 'https://google.com'),
        (blog_page_id, 'hash_visitor_1', 'hash_ip_1', 'San Francisco', 'CA', 'USA', 'Mozilla/5.0...', '/'),
        (apps_page_id, 'hash_visitor_3', 'hash_ip_3', 'London', NULL, 'UK', 'Mozilla/5.0...', 'https://twitter.com');

    -- Sample interactions (using the page_view_id from above)
    -- Note: In real usage, you'd need to get the actual page_view IDs
    -- This is just for demonstration
END $$;
*/
