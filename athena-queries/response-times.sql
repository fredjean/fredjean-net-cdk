-- Response Time Analysis
-- Monitor performance and identify slow pages
-- Critical for user experience and Core Web Vitals
--
-- Usage:
--   Replace the date range in the WHERE clause to match your analysis period

SELECT 
    cs_uri_stem AS page_path,
    COUNT(*) AS request_count,
    AVG(time_taken) AS avg_response_seconds,
    APPROX_PERCENTILE(time_taken, 0.50) AS p50_response_seconds,
    APPROX_PERCENTILE(time_taken, 0.90) AS p90_response_seconds,
    APPROX_PERCENTILE(time_taken, 0.95) AS p95_response_seconds,
    APPROX_PERCENTILE(time_taken, 0.99) AS p99_response_seconds,
    MAX(time_taken) AS max_response_seconds,
    AVG(time_to_first_byte) AS avg_ttfb_seconds,
    -- Cache performance
    SUM(CASE WHEN x_edge_result_type = 'Hit' THEN 1 ELSE 0 END) AS cache_hits,
    SUM(CASE WHEN x_edge_result_type = 'Miss' THEN 1 ELSE 0 END) AS cache_misses,
    ROUND(
        SUM(CASE WHEN x_edge_result_type = 'Hit' THEN 1 ELSE 0 END) * 100.0 / 
        NULLIF(COUNT(*), 0), 
        2
    ) AS cache_hit_ratio_percent
FROM cloudfront_logs.access_logs
WHERE date >= DATE '2025-10-01'  -- Adjust start date
  AND date <= CURRENT_DATE
  AND sc_status >= 200
  AND sc_status < 400
  AND time_taken > 0  -- Exclude zero/null times
GROUP BY cs_uri_stem
HAVING COUNT(*) >= 10  -- Only show pages with meaningful traffic
ORDER BY avg_response_seconds DESC
LIMIT 50;
