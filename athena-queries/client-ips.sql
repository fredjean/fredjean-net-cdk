-- Top Client IPs
-- Identify top visitors by IP address
-- Useful for understanding traffic sources and potential bot activity
--
-- Usage:
--   Replace the date range in the WHERE clause to match your analysis period
--   High request counts from single IPs may indicate bots or crawlers

SELECT 
    c_ip AS client_ip,
    COUNT(*) AS request_count,
    COUNT(DISTINCT cs_uri_stem) AS unique_pages_visited,
    SUM(sc_bytes) / 1024 / 1024 AS total_mb_transferred,
    MIN(date) AS first_seen,
    MAX(date) AS last_seen,
    -- Sample user agent to understand what this IP is
    MAX(cs_user_agent) AS sample_user_agent,
    -- Count of different methods (GET, POST, etc.)
    SUM(CASE WHEN cs_method = 'GET' THEN 1 ELSE 0 END) AS get_requests,
    SUM(CASE WHEN cs_method = 'POST' THEN 1 ELSE 0 END) AS post_requests,
    -- Success vs error rate
    ROUND(
        SUM(CASE WHEN sc_status >= 200 AND sc_status < 300 THEN 1 ELSE 0 END) * 100.0 / 
        NULLIF(COUNT(*), 0), 
        2
    ) AS success_rate_percent
FROM cloudfront_logs.access_logs
WHERE date >= DATE '2025-10-01'  -- Adjust start date
  AND date <= CURRENT_DATE
GROUP BY c_ip
HAVING COUNT(*) >= 10  -- Filter out one-time visitors
ORDER BY request_count DESC
LIMIT 100;
