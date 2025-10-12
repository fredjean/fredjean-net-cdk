-- Bandwidth Usage by Day
-- Track daily bandwidth consumption and request patterns
-- Useful for understanding traffic trends and capacity planning
--
-- Usage:
--   Replace the date range in the WHERE clause to match your analysis period

SELECT 
    date,
    COUNT(*) AS total_requests,
    COUNT(DISTINCT c_ip) AS unique_visitors,
    SUM(sc_bytes) / 1024 / 1024 AS bandwidth_mb,
    SUM(sc_bytes) / 1024 / 1024 / 1024 AS bandwidth_gb,
    AVG(time_taken) AS avg_response_time_seconds,
    SUM(CASE WHEN sc_status >= 200 AND sc_status < 300 THEN 1 ELSE 0 END) AS successful_requests,
    SUM(CASE WHEN sc_status >= 400 THEN 1 ELSE 0 END) AS error_requests,
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
GROUP BY date
ORDER BY date DESC;
