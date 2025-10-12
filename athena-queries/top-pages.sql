-- Top Pages by Request Count
-- Shows the most frequently accessed pages on your website
-- 
-- Usage:
--   Replace the date range in the WHERE clause to match your analysis period
--   Adjust the LIMIT to show more/fewer results

SELECT 
    cs_uri_stem AS page_path,
    COUNT(*) AS request_count,
    COUNT(DISTINCT c_ip) AS unique_visitors,
    SUM(sc_bytes) / 1024 / 1024 AS total_mb_transferred,
    AVG(time_taken) AS avg_response_time_seconds
FROM cloudfront_logs.access_logs
WHERE date >= DATE '2025-10-01'  -- Adjust start date
  AND date <= CURRENT_DATE        -- Up to today
  AND sc_status >= 200            -- Successful requests
  AND sc_status < 400
  AND cs_uri_stem NOT LIKE '%.css'     -- Exclude static assets
  AND cs_uri_stem NOT LIKE '%.js'
  AND cs_uri_stem NOT LIKE '%.png'
  AND cs_uri_stem NOT LIKE '%.jpg'
  AND cs_uri_stem NOT LIKE '%.gif'
  AND cs_uri_stem NOT LIKE '%.ico'
GROUP BY cs_uri_stem
ORDER BY request_count DESC
LIMIT 50;
