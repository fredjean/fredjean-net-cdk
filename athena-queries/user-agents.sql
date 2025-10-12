-- User Agent Analysis
-- Understand browsers, devices, and bot traffic
-- Useful for browser compatibility planning and bot detection
--
-- Usage:
--   Replace the date range in the WHERE clause to match your analysis period

SELECT 
    CASE 
        -- Browsers
        WHEN cs_user_agent LIKE '%Chrome/%' AND cs_user_agent NOT LIKE '%Edg/%' THEN 'Chrome'
        WHEN cs_user_agent LIKE '%Safari/%' AND cs_user_agent NOT LIKE '%Chrome/%' THEN 'Safari'
        WHEN cs_user_agent LIKE '%Firefox/%' THEN 'Firefox'
        WHEN cs_user_agent LIKE '%Edg/%' THEN 'Edge'
        WHEN cs_user_agent LIKE '%MSIE%' OR cs_user_agent LIKE '%Trident/%' THEN 'Internet Explorer'
        -- Bots and crawlers
        WHEN cs_user_agent LIKE '%Googlebot%' THEN 'Googlebot'
        WHEN cs_user_agent LIKE '%bingbot%' THEN 'Bingbot'
        WHEN cs_user_agent LIKE '%DuckDuckBot%' THEN 'DuckDuckBot'
        WHEN cs_user_agent LIKE '%Baiduspider%' THEN 'Baidu Spider'
        WHEN cs_user_agent LIKE '%YandexBot%' THEN 'Yandex Bot'
        WHEN cs_user_agent LIKE '%facebookexternalhit%' THEN 'Facebook Bot'
        WHEN cs_user_agent LIKE '%Twitterbot%' THEN 'Twitter Bot'
        WHEN cs_user_agent LIKE '%LinkedInBot%' THEN 'LinkedIn Bot'
        WHEN cs_user_agent LIKE '%Slackbot%' THEN 'Slack Bot'
        WHEN cs_user_agent LIKE '%bot%' OR cs_user_agent LIKE '%crawler%' OR cs_user_agent LIKE '%spider%' THEN 'Other Bot'
        -- Tools
        WHEN cs_user_agent LIKE '%curl%' THEN 'curl'
        WHEN cs_user_agent LIKE '%Wget%' THEN 'wget'
        WHEN cs_user_agent LIKE '%python%' THEN 'Python Script'
        ELSE 'Other'
    END AS user_agent_category,
    COUNT(*) AS request_count,
    COUNT(DISTINCT c_ip) AS unique_ips,
    SUM(sc_bytes) / 1024 / 1024 AS total_mb_transferred,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS percentage,
    -- Sample full user agent for reference
    MAX(cs_user_agent) AS sample_user_agent
FROM cloudfront_logs.access_logs
WHERE date >= DATE '2025-10-01'  -- Adjust start date
  AND date <= CURRENT_DATE
GROUP BY 
    CASE 
        WHEN cs_user_agent LIKE '%Chrome/%' AND cs_user_agent NOT LIKE '%Edg/%' THEN 'Chrome'
        WHEN cs_user_agent LIKE '%Safari/%' AND cs_user_agent NOT LIKE '%Chrome/%' THEN 'Safari'
        WHEN cs_user_agent LIKE '%Firefox/%' THEN 'Firefox'
        WHEN cs_user_agent LIKE '%Edg/%' THEN 'Edge'
        WHEN cs_user_agent LIKE '%MSIE%' OR cs_user_agent LIKE '%Trident/%' THEN 'Internet Explorer'
        WHEN cs_user_agent LIKE '%Googlebot%' THEN 'Googlebot'
        WHEN cs_user_agent LIKE '%bingbot%' THEN 'Bingbot'
        WHEN cs_user_agent LIKE '%DuckDuckBot%' THEN 'DuckDuckBot'
        WHEN cs_user_agent LIKE '%Baiduspider%' THEN 'Baidu Spider'
        WHEN cs_user_agent LIKE '%YandexBot%' THEN 'Yandex Bot'
        WHEN cs_user_agent LIKE '%facebookexternalhit%' THEN 'Facebook Bot'
        WHEN cs_user_agent LIKE '%Twitterbot%' THEN 'Twitter Bot'
        WHEN cs_user_agent LIKE '%LinkedInBot%' THEN 'LinkedIn Bot'
        WHEN cs_user_agent LIKE '%Slackbot%' THEN 'Slack Bot'
        WHEN cs_user_agent LIKE '%bot%' OR cs_user_agent LIKE '%crawler%' OR cs_user_agent LIKE '%spider%' THEN 'Other Bot'
        WHEN cs_user_agent LIKE '%curl%' THEN 'curl'
        WHEN cs_user_agent LIKE '%Wget%' THEN 'wget'
        WHEN cs_user_agent LIKE '%python%' THEN 'Python Script'
        ELSE 'Other'
    END
ORDER BY request_count DESC
LIMIT 50;
