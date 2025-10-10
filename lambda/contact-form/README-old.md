# Contact Form Lambda Function

This Lambda function processes contact form submissions from the fredjean.net website and sends them via Amazon SES as emails.

## Functionality

The function:
- Validates form input (email, name, phone, message)
- Formats the submission as an email
- Sends the email via Amazon SES to fred@fredjean.net
- Returns appropriate HTTP responses with CORS headers

## Configuration

**Runtime**: Node.js 22.x  
**Handler**: index.handler  
**Timeout**: 10 seconds  
**Memory**: 128 MB

## Environment Variables

None required - all configuration is hardcoded in the function.

## Email Configuration

- **To Address**: Fred Jean <fred@fredjean.net>
- **From Address**: Contact Form <hello@fredjean.net>
- **Reply-To**: Set to the submitter's email

## Validation Rules

- **Email**: Valid email format, max 255 characters
- **Name**: Required, max 100 characters
- **Phone**: Required, max 20 characters
- **Message**: Required, max 1024 characters

## API Format

### Request

```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "phone": "555-1234",
  "message": "Your message here"
}
```

### Success Response

```json
{
  "successMsg": "Thank you for contacting us! Your message has been sent."
}
```

### Error Response

```json
{
  "error": "Error message here"
}
```

## CORS Configuration

The function supports CORS with:
- **Allowed Origins**: * (all origins)
- **Allowed Methods**: POST, OPTIONS
- **Allowed Headers**: Content-Type

## SES Requirements

The function requires:
1. **hello@fredjean.net** to be verified in SES (as the From address)
2. **fred@fredjean.net** to be verified in SES (as the To address)
3. Or the AWS account must be out of SES sandbox mode

## Deployment

The function is deployed via CDK with a Lambda Function URL (no API Gateway required).
