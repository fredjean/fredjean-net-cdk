import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

// Configuration via environment variables (with fallbacks for local development)
const CONFIG = {
  toAddress: process.env.TO_ADDRESS || 'Fred Jean <fred@fredjean.net>',
  fromAddress: process.env.FROM_ADDRESS || 'Contact Form <hello@fredjean.net>',
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
  region: process.env.AWS_REGION || 'us-east-1',
  maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH || '2048', 10),
  maxNameLength: parseInt(process.env.MAX_NAME_LENGTH || '100', 10),
  maxPhoneLength: parseInt(process.env.MAX_PHONE_LENGTH || '20', 10),
  subjectWordCount: parseInt(process.env.SUBJECT_WORD_COUNT || '8', 10),
};

// Validation schemas
const VALIDATION = {
  email: {
    maxLength: 255,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  name: {
    maxLength: CONFIG.maxNameLength,
    pattern: /^[\p{L}\s'-]+$/u, // Unicode letters, spaces, hyphens, apostrophes
  },
  phone: {
    maxLength: CONFIG.maxPhoneLength,
    pattern: /^[\d\s+()-]+$/, // Digits, spaces, and common phone characters
  },
  message: {
    maxLength: CONFIG.maxMessageLength,
    pattern: /^[\p{L}\p{N}\p{P}\p{Z}\n\r]+$/u, // Unicode letters, numbers, punctuation, whitespace
  },
};

/**
 * Validation error class for better error handling
 */
class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Validate and sanitize input field
 */
function validateField(value, fieldName, schema) {
  if (!value || typeof value !== 'string') {
    throw new ValidationError(fieldName, `${fieldName} is required`);
  }

  const trimmed = value.trim();
  
  if (trimmed.length === 0) {
    throw new ValidationError(fieldName, `${fieldName} cannot be empty`);
  }

  if (trimmed.length > schema.maxLength) {
    throw new ValidationError(
      fieldName,
      `${fieldName} must be less than ${schema.maxLength} characters`
    );
  }

  if (schema.pattern && !schema.pattern.test(trimmed)) {
    throw new ValidationError(fieldName, `${fieldName} contains invalid characters`);
  }

  return trimmed;
}

/**
 * Validate contact form data
 */
function validateContactForm(data) {
  return {
    email: validateField(data.email, 'email', VALIDATION.email),
    name: validateField(data.name, 'name', VALIDATION.name),
    phone: validateField(data.phone, 'phone', VALIDATION.phone),
    message: validateField(data.message, 'message', VALIDATION.message),
  };
}

/**
 * Create HTTP response with consistent headers
 */
function createResponse(statusCode, body, additionalHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': CONFIG.allowedOrigin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...additionalHeaders,
    },
    body: JSON.stringify(body),
  };
}

/**
 * Generate email subject from message
 */
function generateSubject(message) {
  const words = message.replace(/\s+/g, ' ').trim().split(' ');
  const subject = words.slice(0, CONFIG.subjectWordCount).join(' ');
  return subject.length < message.length ? `${subject}...` : subject;
}

/**
 * Format email body
 */
function formatEmailBody(contactData) {
  return [
    'New Contact Form Submission',
    '',
    `Name: ${contactData.name}`,
    `Email: ${contactData.email}`,
    `Phone: ${contactData.phone}`,
    '',
    'Message:',
    contactData.message,
    '',
    '---',
    `Submitted: ${new Date().toISOString()}`,
  ].join('\n');
}

/**
 * Send email via SES
 */
async function sendEmail(contactData, sesClient) {
  const subject = generateSubject(contactData.message);
  const body = formatEmailBody(contactData);
  const replyTo = `${contactData.name} <${contactData.email}>`;

  const command = new SendEmailCommand({
    Destination: {
      ToAddresses: [CONFIG.toAddress],
    },
    Message: {
      Body: {
        Text: {
          Data: body,
          Charset: 'UTF-8',
        },
      },
      Subject: {
        Data: subject,
        Charset: 'UTF-8',
      },
    },
    Source: CONFIG.fromAddress,
    ReplyToAddresses: [replyTo],
  });

  const result = await sesClient.send(command);
  return result.MessageId;
}

/**
 * Main Lambda handler
 */
export async function handler(event, context, sesClient) {
  // Use injected client for testing, or create new one
  const client = (sesClient && typeof sesClient === 'object') ? sesClient : new SESClient({ region: CONFIG.region });

  // Add request ID to all logs
  const requestId = context?.awsRequestId || context?.requestId || 'local';
  const log = (level, message, data = {}) => {
    console.log(JSON.stringify({
      level,
      requestId,
      message,
      ...data,
    }));
  };

  try {
    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
      return createResponse(200, { message: 'OK' });
    }

    log('info', 'Processing contact form submission');

    // Parse request body
    let data;
    try {
      const body = event.body;
      const isBase64 = event.isBase64Encoded;
      
      // Decode base64 if needed
      const decodedBody = isBase64 ? Buffer.from(body, 'base64').toString('utf-8') : body;
      
      // Determine content type
      const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';
      
      if (contentType.includes('application/x-www-form-urlencoded')) {
        // Parse URL-encoded form data
        const params = new URLSearchParams(decodedBody);
        data = Object.fromEntries(params.entries());
        log('info', 'Parsed URL-encoded form data');
      } else {
        // Parse JSON
        data = typeof decodedBody === 'string' ? JSON.parse(decodedBody) : decodedBody;
        log('info', 'Parsed JSON data');
      }
    } catch (error) {
      log('warn', 'Invalid request body', { error: error.message });
      return createResponse(400, { error: 'Invalid request format' });
    }

    // Validate input
    let contactData;
    try {
      contactData = validateContactForm(data);
    } catch (error) {
      if (error instanceof ValidationError) {
        log('warn', 'Validation failed', { field: error.field, message: error.message });
        return createResponse(400, {
          error: error.message,
          field: error.field,
        });
      }
      throw error;
    }

    // Send email
    const messageId = await sendEmail(contactData, client);
    
    log('info', 'Email sent successfully', { messageId });

    return createResponse(200, {
      message: 'Thank you for contacting us! Your message has been sent.',
      success: true,
    });

  } catch (error) {
    log('error', 'Failed to process contact form', {
      error: error.message,
      stack: error.stack,
    });

    // Don't expose internal errors to client
    return createResponse(500, {
      error: 'Unable to send message. Please try again later.',
    });
  }
}

// Export validation functions for testing
export { validateField, validateContactForm, generateSubject, formatEmailBody };
