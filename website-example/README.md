# Example Website

This directory contains a sample static website that you can deploy to test your infrastructure.

## Files

- `index.html` - Main landing page
- `error.html` - Custom 404 error page

## How to Deploy

### Option 1: Using AWS CLI

```bash
# Replace YOUR-BUCKET-NAME with the bucket name from CDK outputs
aws s3 sync website-example/ s3://YOUR-BUCKET-NAME

# Replace YOUR-DISTRIBUTION-ID with the distribution ID from CDK outputs
aws cloudfront create-invalidation \
  --distribution-id YOUR-DISTRIBUTION-ID \
  --paths "/*"
```

### Option 2: Using GitHub Actions

1. Rename this directory to `website/`
2. Commit and push to main branch
3. GitHub Actions will automatically deploy

```bash
mv website-example website
git add website
git commit -m "Add website content"
git push origin main
```

## Customize

Feel free to replace these files with your own static website content:

- HTML files
- CSS stylesheets
- JavaScript files
- Images and assets
- Any other static content

The infrastructure supports:
- Single Page Applications (SPAs)
- Multi-page websites
- Static site generators (Hugo, Jekyll, Gatsby, etc.)
- Any content that can be served statically

## Testing Locally

You can test the website locally with any HTTP server:

```bash
# Using Python 3
python -m http.server 8000

# Using Node.js
npx serve .

# Using PHP
php -S localhost:8000
```

Then visit http://localhost:8000 in your browser.
