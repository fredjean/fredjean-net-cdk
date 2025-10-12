-- HTTP Status Code Distribution
-- Analyze the distribution of HTTP response codes
-- Useful for identifying errors, broken links, and overall health
--
-- Usage:
--   Replace the date range in the WHERE clause to match your analysis period

SELECT 
    sc_status AS status_code,
    CASE 
        WHEN sc_status BETWEEN 200 AND 299 THEN 'Success'
        WHEN sc_status BETWEEN 300 AND 399 THEN 'Redirect'
        WHEN sc_status BETWEEN 400 AND 499 THEN 'Client Error'
        WHEN sc_status BETWEEN 500 AND 599 THEN 'Server Error'
        ELSE 'Other'
    END AS status_category,
    COUNT(*) AS request_count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS percentage,
    SUM(sc_bytes) / 1024 / 1024 AS total_mb_transferred
FROM cloudfront_logs.access_logs
WHERE date >= DATE '2025-10-01'  -- Adjust start date
  AND date <= CURRENT_DATE
GROUP BY sc_status
ORDER BY request_count DESC;
