-- Top Referrers
-- Identify where your traffic is coming from
-- Useful for understanding marketing effectiveness and backlink sources
--
-- Usage:
--   Replace the date range in the WHERE clause to match your analysis period

SELECT 
    CASE 
        WHEN cs_referer = '-' THEN 'Direct / No Referrer'
        WHEN cs_referer LIKE '%google.%' THEN 'Google Search'
        WHEN cs_referer LIKE '%bing.%' THEN 'Bing Search'
        WHEN cs_referer LIKE '%duckduckgo.%' THEN 'DuckDuckGo'
        WHEN cs_referer LIKE '%facebook.%' THEN 'Facebook'
        WHEN cs_referer LIKE '%twitter.%' OR cs_referer LIKE '%t.co%' THEN 'Twitter/X'
        WHEN cs_referer LIKE '%linkedin.%' THEN 'LinkedIn'
        WHEN cs_referer LIKE '%reddit.%' THEN 'Reddit'
        WHEN cs_referer LIKE '%github.%' THEN 'GitHub'
        ELSE cs_referer
    END AS referrer_source,
    COUNT(*) AS request_count,
    COUNT(DISTINCT c_ip) AS unique_visitors,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS percentage
FROM cloudfront_logs.access_logs
WHERE date >= DATE '2025-10-01'  -- Adjust start date
  AND date <= CURRENT_DATE
  AND sc_status >= 200
  AND sc_status < 400
GROUP BY 
    CASE 
        WHEN cs_referer = '-' THEN 'Direct / No Referrer'
        WHEN cs_referer LIKE '%google.%' THEN 'Google Search'
        WHEN cs_referer LIKE '%bing.%' THEN 'Bing Search'
        WHEN cs_referer LIKE '%duckduckgo.%' THEN 'DuckDuckGo'
        WHEN cs_referer LIKE '%facebook.%' THEN 'Facebook'
        WHEN cs_referer LIKE '%twitter.%' OR cs_referer LIKE '%t.co%' THEN 'Twitter/X'
        WHEN cs_referer LIKE '%linkedin.%' THEN 'LinkedIn'
        WHEN cs_referer LIKE '%reddit.%' THEN 'Reddit'
        WHEN cs_referer LIKE '%github.%' THEN 'GitHub'
        ELSE cs_referer
    END
ORDER BY request_count DESC
LIMIT 50;
