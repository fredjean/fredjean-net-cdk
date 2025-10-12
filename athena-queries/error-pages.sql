-- Error Pages (4xx and 5xx)
-- Identify broken links, missing pages, and server errors
-- Critical for improving user experience and SEO
--
-- Usage:
--   Replace the date range in the WHERE clause to match your analysis period

SELECT 
    cs_uri_stem AS page_path,
    sc_status AS status_code,
    CASE 
        WHEN sc_status = 404 THEN 'Not Found'
        WHEN sc_status = 403 THEN 'Forbidden'
        WHEN sc_status = 400 THEN 'Bad Request'
        WHEN sc_status = 500 THEN 'Internal Server Error'
        WHEN sc_status = 502 THEN 'Bad Gateway'
        WHEN sc_status = 503 THEN 'Service Unavailable'
        ELSE 'Other Error'
    END AS error_description,
    COUNT(*) AS error_count,
    COUNT(DISTINCT c_ip) AS unique_visitors_affected,
    -- Sample referrers to understand where bad links come from
    MAX(CASE WHEN cs_referer != '-' THEN cs_referer ELSE NULL END) AS sample_referrer
FROM cloudfront_logs.access_logs
WHERE date >= DATE '2025-10-01'  -- Adjust start date
  AND date <= CURRENT_DATE
  AND sc_status >= 400  -- Client and server errors
GROUP BY cs_uri_stem, sc_status
ORDER BY error_count DESC
LIMIT 100;
