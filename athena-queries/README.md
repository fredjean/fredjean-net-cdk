# CloudFront Log Analysis with Amazon Athena

This directory contains SQL queries for analyzing CloudFront access logs using Amazon Athena. The infrastructure is automatically deployed via CDK and provides powerful analytics capabilities for understanding your website traffic.

## Overview

Your CloudFront logs are automatically analyzed using:
- **AWS Glue Database**: `cloudfront_logs`
- **AWS Glue Table**: `access_logs` (33 columns, CloudFront standard format)
- **Athena Workgroup**: `primary`
- **Query Results**: Stored in `fredjean.net-athena-results` S3 bucket
- **Log Location**: `s3://[log-bucket]/cloudfront-logs/`

## Quick Start

### Via AWS Console

1. Open [Amazon Athena Console](https://console.aws.amazon.com/athena/)
2. Select **Query editor** from the left menu
3. Ensure **cloudfront_logs** database is selected in the dropdown
4. Copy one of the queries from this directory
5. Update the date range in the `WHERE` clause
6. Click **Run query**

### Via AWS CLI

```bash
# Run a query
aws athena start-query-execution \
  --query-string "$(cat athena-queries/top-pages.sql)" \
  --query-execution-context Database=cloudfront_logs \
  --result-configuration OutputLocation=s3://fredjean.net-athena-results/ \
  --region us-east-1

# Get query results
aws athena get-query-results --query-execution-id <execution-id> --region us-east-1
```

## Available Queries

| Query File | Description | Use Case |
|------------|-------------|----------|
| `top-pages.sql` | Most accessed pages with traffic metrics | Content strategy, popular content |
| `status-codes.sql` | HTTP status code distribution | Site health, error monitoring |
| `top-referrers.sql` | Traffic sources (search engines, social, etc.) | Marketing effectiveness |
| `bandwidth-by-day.sql` | Daily bandwidth and traffic trends | Capacity planning, trending |
| `error-pages.sql` | 404s, 403s, and other errors | Fix broken links, improve UX |
| `response-times.sql` | Performance analysis with percentiles | Performance optimization |
| `client-ips.sql` | Top visitor IPs | Bot detection, traffic sources |
| `user-agents.sql` | Browser, bot, and device analysis | Browser compatibility, bot traffic |

## Query Examples

### Example 1: Find Your Most Popular Pages

```sql
SELECT 
    cs_uri_stem AS page_path,
    COUNT(*) AS request_count,
    COUNT(DISTINCT c_ip) AS unique_visitors
FROM cloudfront_logs.access_logs
WHERE date >= DATE '2025-10-01'
  AND sc_status >= 200
  AND sc_status < 400
GROUP BY cs_uri_stem
ORDER BY request_count DESC
LIMIT 20;
```

### Example 2: Analyze Traffic by Hour

```sql
SELECT 
    date,
    SUBSTRING(time, 1, 2) AS hour,
    COUNT(*) AS requests
FROM cloudfront_logs.access_logs
WHERE date = CURRENT_DATE
GROUP BY date, SUBSTRING(time, 1, 2)
ORDER BY hour;
```

### Example 3: Identify Broken Links (404s)

```sql
SELECT 
    cs_uri_stem AS broken_page,
    COUNT(*) AS error_count,
    MAX(cs_referer) AS referrer_example
FROM cloudfront_logs.access_logs
WHERE date >= CURRENT_DATE - INTERVAL '7' DAY
  AND sc_status = 404
GROUP BY cs_uri_stem
ORDER BY error_count DESC
LIMIT 25;
```

## Column Reference

### Key CloudFront Log Columns

| Column | Type | Description |
|--------|------|-------------|
| `date` | DATE | Request date (YYYY-MM-DD) |
| `time` | STRING | Request time (HH:MM:SS UTC) |
| `c_ip` | STRING | Client IP address |
| `cs_method` | STRING | HTTP method (GET, POST, etc.) |
| `cs_uri_stem` | STRING | Request path (/about/index.html) |
| `sc_status` | INT | HTTP status code (200, 404, etc.) |
| `sc_bytes` | BIGINT | Bytes sent to client |
| `time_taken` | DOUBLE | Total request time (seconds) |
| `cs_referer` | STRING | Referrer URL |
| `cs_user_agent` | STRING | User-Agent header |
| `x_edge_location` | STRING | CloudFront edge location |
| `x_edge_result_type` | STRING | Cache status (Hit, Miss, Error) |
| `time_to_first_byte` | DOUBLE | TTFB in seconds |

**Full schema**: See [CloudFront Standard Logs Documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html#LogFileFormat)

## Cost Optimization

### Query Costs

Athena charges **$5 per TB of data scanned**. CloudFront logs are typically very efficient:

- **Personal blog** (1,000 requests/day): ~$0.01/month
- **Small site** (10,000 requests/day): ~$0.05/month  
- **Medium site** (100,000 requests/day): ~$0.25/month

### Best Practices

1. **Use date filters** - Always filter by date to limit data scanned:
   ```sql
   WHERE date >= DATE '2025-10-01' AND date <= CURRENT_DATE
   ```

2. **Partition your queries** - Query recent data separately from historical:
   ```sql
   -- Last 7 days only
   WHERE date >= CURRENT_DATE - INTERVAL '7' DAY
   ```

3. **Limit result sets** - Use `LIMIT` to avoid scanning unnecessary data:
   ```sql
   LIMIT 100
   ```

4. **Exclude static assets** when analyzing page traffic:
   ```sql
   AND cs_uri_stem NOT LIKE '%.css'
   AND cs_uri_stem NOT LIKE '%.js'
   ```

5. **Use APPROX functions** for faster queries:
   ```sql
   APPROX_PERCENTILE(time_taken, 0.95)  -- Instead of PERCENTILE_CONT
   ```

6. **Cache results** - Athena caches results for 24 hours. Re-running identical queries is free.

## Common Use Cases

### 1. Monitor Site Health

Run `status-codes.sql` daily to check error rates:
```bash
aws athena start-query-execution \
  --query-string "$(cat athena-queries/status-codes.sql)" \
  --query-execution-context Database=cloudfront_logs \
  --result-configuration OutputLocation=s3://fredjean.net-athena-results/
```

### 2. Identify Performance Issues

Use `response-times.sql` to find slow pages and optimize them.

### 3. Fix Broken Links

Run `error-pages.sql` weekly to identify and fix 404 errors before they affect SEO.

### 4. Understand Traffic Sources

Use `top-referrers.sql` to see where your visitors come from and optimize marketing efforts.

### 5. Bot Detection

Check `user-agents.sql` and `client-ips.sql` to identify bot traffic and potential scrapers.

## Advanced Analysis

### Geographic Distribution

```sql
SELECT 
    SUBSTRING(x_edge_location, 1, 3) AS region_code,
    COUNT(*) AS requests,
    COUNT(DISTINCT c_ip) AS unique_visitors
FROM cloudfront_logs.access_logs
WHERE date >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY SUBSTRING(x_edge_location, 1, 3)
ORDER BY requests DESC;
```

### Cache Performance

```sql
SELECT 
    date,
    SUM(CASE WHEN x_edge_result_type = 'Hit' THEN 1 ELSE 0 END) AS cache_hits,
    SUM(CASE WHEN x_edge_result_type = 'Miss' THEN 1 ELSE 0 END) AS cache_misses,
    ROUND(
        SUM(CASE WHEN x_edge_result_type = 'Hit' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 
        2
    ) AS cache_hit_ratio_percent
FROM cloudfront_logs.access_logs
WHERE date >= CURRENT_DATE - INTERVAL '7' DAY
GROUP BY date
ORDER BY date DESC;
```

### Peak Traffic Times

```sql
SELECT 
    SUBSTRING(time, 1, 2) AS hour_utc,
    AVG(request_count) AS avg_requests_per_day
FROM (
    SELECT 
        date,
        SUBSTRING(time, 1, 2) AS hour,
        COUNT(*) AS request_count
    FROM cloudfront_logs.access_logs
    WHERE date >= CURRENT_DATE - INTERVAL '30' DAY
    GROUP BY date, SUBSTRING(time, 1, 2)
)
GROUP BY SUBSTRING(time, 1, 2)
ORDER BY hour_utc;
```

## Troubleshooting

### No Data Returned

**Problem**: Query returns 0 rows

**Solutions**:
1. Check date range - logs may not exist for that period
2. Verify table location matches log bucket
3. Ensure CloudFront logging is enabled (it is for this stack)
4. Run: `SELECT COUNT(*) FROM cloudfront_logs.access_logs` to verify data exists

### Query Fails with "HIVE_BAD_DATA"

**Problem**: Data format doesn't match schema

**Solutions**:
1. Verify logs are in CloudFront standard format (tab-delimited)
2. Check that `skip.header.line.count` is set to `2`
3. Logs compressed with gzip (`.gz`) are supported automatically

### High Query Costs

**Problem**: Queries scanning too much data

**Solutions**:
1. Always add date filters to `WHERE` clause
2. Consider adding partitioning (advanced, requires Glue Crawler)
3. Use smaller date ranges for exploratory queries
4. Enable query result caching (enabled by default for 24 hours)

### Permission Denied

**Problem**: Cannot read from S3 or write results

**Solutions**:
1. Verify IAM permissions for Athena service role
2. Check S3 bucket policies on log bucket and results bucket
3. Ensure you're using the correct AWS region (us-east-1)

## Integration with Other Tools

### Export to CSV

```bash
# Run query and get execution ID
EXECUTION_ID=$(aws athena start-query-execution \
  --query-string "$(cat athena-queries/top-pages.sql)" \
  --query-execution-context Database=cloudfront_logs \
  --result-configuration OutputLocation=s3://fredjean.net-athena-results/ \
  --region us-east-1 \
  --query 'QueryExecutionId' \
  --output text)

# Wait for completion (check status)
aws athena get-query-execution --query-execution-id $EXECUTION_ID --region us-east-1

# Download results from S3
aws s3 cp s3://fredjean.net-athena-results/$EXECUTION_ID.csv ./results.csv
```

### Visualize with QuickSight

1. Open [Amazon QuickSight](https://quicksight.aws.amazon.com/)
2. Create new dataset
3. Select "Athena" as data source
4. Choose `cloudfront_logs` database and `access_logs` table
5. Build dashboards with drag-and-drop interface

### Schedule Queries with Lambda

Create a Lambda function to run queries on a schedule:
```python
import boto3
athena = boto3.client('athena')

def lambda_handler(event, context):
    response = athena.start_query_execution(
        QueryString='SELECT ...',
        QueryExecutionContext={'Database': 'cloudfront_logs'},
        ResultConfiguration={
            'OutputLocation': 's3://fredjean.net-athena-results/'
        }
    )
    return response
```

## Additional Resources

- [CloudFront Logging Documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/logging.html)
- [Athena SQL Reference](https://docs.aws.amazon.com/athena/latest/ug/ddl-sql-reference.html)
- [Presto Functions](https://prestodb.io/docs/current/functions.html) (Athena uses Presto)
- [AWS Athena Pricing](https://aws.amazon.com/athena/pricing/)

## Support

For issues related to:
- **Infrastructure**: Check CDK stack in `fredjean-net-cdk` repo
- **Queries**: Modify SQL files in this directory
- **AWS Athena**: See [AWS Athena Documentation](https://docs.aws.amazon.com/athena/)

## Next Steps

1. **Set up alerts**: Use CloudWatch + Lambda to monitor error rates
2. **Create dashboards**: Build QuickSight dashboards for daily monitoring
3. **Add partitioning**: For very high traffic, partition by year/month/day
4. **Automate reports**: Schedule weekly email reports with Lambda + SES
