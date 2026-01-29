import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

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
  spamDetectionEnabled: process.env.SPAM_DETECTION_ENABLED === 'true',
  spamModelId: process.env.SPAM_MODEL_ID || 'anthropic.claude-haiku-4-5-20251001-v1:0',
  spamConfidenceThreshold: parseFloat(process.env.SPAM_CONFIDENCE_THRESHOLD || '0.8'),
  blockedSubmissionsTable: process.env.BLOCKED_SUBMISSIONS_TABLE || 'contact-form-blocked-submissions',
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
function generateSubject(message, classificationResult = null) {
  const words = message.replace(/\s+/g, ' ').trim().split(' ');
  let subject = words.slice(0, CONFIG.subjectWordCount).join(' ');
  subject = subject.length < message.length ? `${subject}...` : subject;
  
  // Add 🤨 emoji if not clean (SALES or low-confidence LEGITIMATE)
  if (classificationResult) {
    const isNotClean = classificationResult.classification === 'SALES' ||
                      (classificationResult.classification === 'LEGITIMATE' && classificationResult.confidence < 0.9);
    if (isNotClean) {
      subject = `🤨 ${subject}`;
    }
  }
  
  return subject;
}

/**
 * Format email body
 */
function formatEmailBody(contactData, classificationResult = null) {
  const lines = [
    'New Contact Form Submission',
    '',
    `Name: ${contactData.name}`,
    `Email: ${contactData.email}`,
    `Phone: ${contactData.phone}`,
    '',
  ];

  // Add spam classification info if available
  if (classificationResult) {
    lines.push('Spam Detection:');
    lines.push(`  Classification: ${classificationResult.classification}`);
    lines.push(`  Confidence: ${(classificationResult.confidence * 100).toFixed(1)}%`);
    lines.push(`  Reason: ${classificationResult.reason}`);
    if (classificationResult.failedOpen) {
      lines.push('  ⚠️  Bedrock classification failed - failed open');
    }
    lines.push('');
  }

  lines.push('Message:');
  lines.push(contactData.message);
  lines.push('');
  lines.push('---');
  lines.push(`Submitted: ${new Date().toISOString()}`);

  return lines.join('\n');
}

/**
 * Classify submission using Bedrock
 */
async function classifySubmission(contactData, bedrockClient) {
  const prompt = `Analyze this contact form submission and classify it. Respond ONLY with valid JSON in this exact format:
{"classification": "LEGITIMATE|SPAM|SALES|GIBBERISH", "confidence": 0.0-1.0, "reason": "brief explanation"}

Classifications:
- LEGITIMATE: Real person with genuine inquiry or feedback
- SPAM: Automated spam, phishing attempts, or malicious content
- SALES: Someone trying to sell services, products, or SEO services
- GIBBERISH: Random text, keyboard mashing, or nonsensical content

Submission:
Name: ${contactData.name}
Email: ${contactData.email}
Phone: ${contactData.phone}
Message: ${contactData.message}`;

  try {
    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: CONFIG.spamModelId,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    let classificationText = responseBody.content[0].text.trim();
    
    // Remove markdown code fences if present (```json ... ```)
    if (classificationText.startsWith('```')) {
      classificationText = classificationText
        .replace(/^```(?:json)?\n/, '') // Remove opening fence
        .replace(/\n```$/, '');          // Remove closing fence
    }
    
    // Parse JSON response
    const result = JSON.parse(classificationText);
    
    return {
      classification: result.classification,
      confidence: result.confidence,
      reason: result.reason,
    };
  } catch (error) {
    // Fail open: treat as legitimate if classification fails
    console.error('Spam classification failed, failing open', { error: error.message });
    return {
      classification: 'LEGITIMATE',
      confidence: 0.0,
      reason: `Classification error: ${error.message}`,
      failedOpen: true,
    };
  }
}

/**
 * Log blocked submission to DynamoDB
 */
async function logBlockedSubmission(contactData, classificationResult, event, dynamoClient) {
  try {
    const submissionId = randomUUID();
    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + (90 * 24 * 60 * 60); // 90 days from now

    // Extract IP address from event
    const ipAddress = event.requestContext?.http?.sourceIp || 
                     event.requestContext?.identity?.sourceIp || 
                     'unknown';

    const item = {
      submissionId,
      timestamp,
      ttl,
      name: contactData.name,
      email: contactData.email,
      phone: contactData.phone,
      message: contactData.message,
      classification: classificationResult.classification,
      confidence: classificationResult.confidence,
      reason: classificationResult.reason,
      ipAddress,
      blockedAt: new Date().toISOString(),
    };

    const command = new PutCommand({
      TableName: CONFIG.blockedSubmissionsTable,
      Item: item,
    });

    await dynamoClient.send(command);
    return submissionId;
  } catch (error) {
    // Log error but don't fail the request
    console.error('Failed to log blocked submission to DynamoDB', {
      error: error.message,
      stack: error.stack,
    });
    return null;
  }
}

/**
 * Send email via SES
 */
async function sendEmail(contactData, sesClient, classificationResult = null) {
  const subject = generateSubject(contactData.message, classificationResult);
  const body = formatEmailBody(contactData, classificationResult);
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
export async function handler(event, context, sesClient, bedrockClient, dynamoClient) {
  // Use injected clients for testing, or create new ones
  const sesClientInstance = (sesClient && typeof sesClient === 'object') ? sesClient : new SESClient({ region: CONFIG.region });
  const bedrockClientInstance = (bedrockClient && typeof bedrockClient === 'object') ? bedrockClient : new BedrockRuntimeClient({ region: CONFIG.region });
  const dynamoClientInstance = (dynamoClient && typeof dynamoClient === 'object') ? dynamoClient : DynamoDBDocumentClient.from(new DynamoDBClient({ region: CONFIG.region }));

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

    // Spam detection (if enabled)
    let classificationResult = null;
    if (CONFIG.spamDetectionEnabled) {
      classificationResult = await classifySubmission(contactData, bedrockClientInstance);
      
      log('info', 'Spam classification completed', {
        classification: classificationResult.classification,
        confidence: classificationResult.confidence,
        failedOpen: classificationResult.failedOpen || false,
      });

      // Block if high-confidence spam or gibberish
      const isSpamOrGibberish = ['SPAM', 'GIBBERISH'].includes(classificationResult.classification);
      const isHighConfidence = classificationResult.confidence >= CONFIG.spamConfidenceThreshold;
      
      if (isSpamOrGibberish && isHighConfidence) {
        // Log blocked submission to DynamoDB
        const submissionId = await logBlockedSubmission(
          contactData,
          classificationResult,
          event,
          dynamoClientInstance
        );
        
        log('warn', 'Blocked spam submission', {
          submissionId,
          classification: classificationResult.classification,
          confidence: classificationResult.confidence,
          reason: classificationResult.reason,
        });

        // Always return 200 OK to avoid revealing detection
        return createResponse(200, {
          message: 'Thank you for contacting us! Your message has been sent.',
          success: true,
        });
      }
    }

    // Send email (legitimate submission or spam detection disabled)
    const messageId = await sendEmail(contactData, sesClientInstance, classificationResult);
    
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

// Export functions for testing
export { 
  validateField, 
  validateContactForm, 
  generateSubject, 
  formatEmailBody,
  classifySubmission,
  logBlockedSubmission,
};
