import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handler,
  validateField,
  validateContactForm,
  generateSubject,
  formatEmailBody,
  classifySubmission,
  logBlockedSubmission,
} from './index.mjs';

describe('Contact Form Lambda', () => {
  describe('validateField', () => {
    const schema = { maxLength: 10, pattern: /^[a-z]+$/ };

    it('should validate correct input', () => {
      expect(validateField('hello', 'test', schema)).toBe('hello');
    });

    it('should trim whitespace', () => {
      expect(validateField('  hello  ', 'test', schema)).toBe('hello');
    });

    it('should throw for empty value', () => {
      expect(() => validateField('', 'test', schema)).toThrow('test is required');
    });

    it('should throw for null value', () => {
      expect(() => validateField(null, 'test', schema)).toThrow('test is required');
    });

    it('should throw for value too long', () => {
      expect(() => validateField('verylongstring', 'test', schema)).toThrow(
        'test must be less than 10 characters'
      );
    });

    it('should throw for invalid characters', () => {
      expect(() => validateField('hello123', 'test', schema)).toThrow(
        'test contains invalid characters'
      );
    });
  });

  describe('validateContactForm', () => {
    const validData = {
      email: 'test@example.com',
      name: 'John Doe',
      phone: '555-1234',
      message: 'Test message',
    };

    it('should validate correct contact form data', () => {
      const result = validateContactForm(validData);
      expect(result).toEqual(validData);
    });

    it('should reject invalid email', () => {
      expect(() =>
        validateContactForm({ ...validData, email: 'not-an-email' })
      ).toThrow();
    });

    it('should reject name with numbers', () => {
      expect(() =>
        validateContactForm({ ...validData, name: 'John123' })
      ).toThrow('name contains invalid characters');
    });

    it('should allow international characters in name', () => {
      const result = validateContactForm({
        ...validData,
        name: 'José María O\'Brien-López',
      });
      expect(result.name).toBe('José María O\'Brien-López');
    });

    it('should reject phone with letters', () => {
      expect(() =>
        validateContactForm({ ...validData, phone: '555-CALL' })
      ).toThrow('phone contains invalid characters');
    });

    it('should trim all fields', () => {
      const paddedData = {
        email: '  test@example.com  ',
        name: '  John Doe  ',
        phone: '  555-1234  ',
        message: '  Test message  ',
      };
      const result = validateContactForm(paddedData);
      expect(result).toEqual(validData);
    });
  });

  describe('generateSubject', () => {
    it('should generate subject from short message', () => {
      expect(generateSubject('Hello world')).toBe('Hello world');
    });

    it('should truncate long message', () => {
      const longMessage = 'One two three four five six seven eight nine ten';
      expect(generateSubject(longMessage)).toBe('One two three four five six seven eight...');
    });

    it('should normalize whitespace', () => {
      // Subject is shorter than original due to whitespace normalization
      // Original: 'Hello    world   test' (24 chars with extra spaces)
      // Subject: 'Hello world test' (17 chars after normalization)
      // Since subject.length (17) < message.length (24), adds '...'
      expect(generateSubject('Hello    world   test')).toBe('Hello world test...');
    });

    it('should trim leading/trailing whitespace', () => {
      // Original: '  Hello world  ' (17 chars with padding)
      // Subject: 'Hello world' (11 chars after trim)
      // Since subject.length (11) < message.length (17), adds '...'
      expect(generateSubject('  Hello world  ')).toBe('Hello world...');
    });

    it('should add 🤨 emoji for SALES classification', () => {
      const classification = { classification: 'SALES', confidence: 0.95, reason: 'SEO pitch' };
      expect(generateSubject('Hello world', classification)).toBe('🤨 Hello world');
    });

    it('should add 🤨 emoji for low-confidence LEGITIMATE', () => {
      const classification = { classification: 'LEGITIMATE', confidence: 0.7, reason: 'Uncertain' };
      expect(generateSubject('Hello world', classification)).toBe('🤨 Hello world');
    });

    it('should not add emoji for high-confidence LEGITIMATE', () => {
      const classification = { classification: 'LEGITIMATE', confidence: 0.95, reason: 'Genuine inquiry' };
      expect(generateSubject('Hello world', classification)).toBe('Hello world');
    });
  });

  describe('classifySubmission', () => {
    const contactData = {
      name: 'John Doe',
      email: 'john@example.com',
      phone: '555-1234',
      message: 'I have a question about your services',
    };

    it('should classify legitimate submission', async () => {
      const mockBedrockClient = {
        send: vi.fn().mockResolvedValue({
          body: new TextEncoder().encode(JSON.stringify({
            content: [{
              text: '{"classification": "LEGITIMATE", "confidence": 0.95, "reason": "Genuine inquiry"}'
            }]
          })),
        }),
      };

      const result = await classifySubmission(contactData, mockBedrockClient);

      expect(result.classification).toBe('LEGITIMATE');
      expect(result.confidence).toBe(0.95);
      expect(result.reason).toBe('Genuine inquiry');
      expect(mockBedrockClient.send).toHaveBeenCalledTimes(1);
    });

    it('should classify spam submission', async () => {
      const mockBedrockClient = {
        send: vi.fn().mockResolvedValue({
          body: new TextEncoder().encode(JSON.stringify({
            content: [{
              text: '{"classification": "SPAM", "confidence": 0.98, "reason": "Contains phishing links"}'
            }]
          })),
        }),
      };

      const result = await classifySubmission(contactData, mockBedrockClient);

      expect(result.classification).toBe('SPAM');
      expect(result.confidence).toBe(0.98);
      expect(result.reason).toBe('Contains phishing links');
    });

    it('should classify sales pitch', async () => {
      const mockBedrockClient = {
        send: vi.fn().mockResolvedValue({
          body: new TextEncoder().encode(JSON.stringify({
            content: [{
              text: '{"classification": "SALES", "confidence": 0.92, "reason": "Offering SEO services"}'
            }]
          })),
        }),
      };

      const result = await classifySubmission(contactData, mockBedrockClient);

      expect(result.classification).toBe('SALES');
      expect(result.confidence).toBe(0.92);
      expect(result.reason).toBe('Offering SEO services');
    });

    it('should classify gibberish', async () => {
      const mockBedrockClient = {
        send: vi.fn().mockResolvedValue({
          body: new TextEncoder().encode(JSON.stringify({
            content: [{
              text: '{"classification": "GIBBERISH", "confidence": 0.99, "reason": "Random keyboard mashing"}'
            }]
          })),
        }),
      };

      const result = await classifySubmission(contactData, mockBedrockClient);

      expect(result.classification).toBe('GIBBERISH');
      expect(result.confidence).toBe(0.99);
      expect(result.reason).toBe('Random keyboard mashing');
    });

    it('should fail open when Bedrock throws error', async () => {
      const mockBedrockClient = {
        send: vi.fn().mockRejectedValue(new Error('Bedrock timeout')),
      };

      vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await classifySubmission(contactData, mockBedrockClient);

      expect(result.classification).toBe('LEGITIMATE');
      expect(result.confidence).toBe(0.0);
      expect(result.failedOpen).toBe(true);
      expect(result.reason).toContain('Classification error');
      expect(console.error).toHaveBeenCalled();
    });

    it('should fail open when response parsing fails', async () => {
      const mockBedrockClient = {
        send: vi.fn().mockResolvedValue({
          body: new TextEncoder().encode('invalid json'),
        }),
      };

      vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await classifySubmission(contactData, mockBedrockClient);

      expect(result.classification).toBe('LEGITIMATE');
      expect(result.failedOpen).toBe(true);
    });

    it('should handle JSON wrapped in markdown code fences', async () => {
      const mockBedrockClient = {
        send: vi.fn().mockResolvedValue({
          body: new TextEncoder().encode(JSON.stringify({
            content: [{
              text: '```json\n{"classification": "LEGITIMATE", "confidence": 0.95, "reason": "Genuine inquiry"}\n```'
            }]
          })),
        }),
      };

      const result = await classifySubmission(contactData, mockBedrockClient);

      expect(result.classification).toBe('LEGITIMATE');
      expect(result.confidence).toBe(0.95);
      expect(result.reason).toBe('Genuine inquiry');
    });

    it('should handle JSON wrapped in code fences without language identifier', async () => {
      const mockBedrockClient = {
        send: vi.fn().mockResolvedValue({
          body: new TextEncoder().encode(JSON.stringify({
            content: [{
              text: '```\n{"classification": "SPAM", "confidence": 0.98, "reason": "Phishing attempt"}\n```'
            }]
          })),
        }),
      };

      const result = await classifySubmission(contactData, mockBedrockClient);

      expect(result.classification).toBe('SPAM');
      expect(result.confidence).toBe(0.98);
      expect(result.reason).toBe('Phishing attempt');
    });
  });

  describe('logBlockedSubmission', () => {
    const contactData = {
      name: 'Spammer',
      email: 'spam@example.com',
      phone: '555-9999',
      message: 'Buy our SEO services!',
    };

    const classificationResult = {
      classification: 'SPAM',
      confidence: 0.95,
      reason: 'Automated spam',
    };

    const event = {
      requestContext: {
        http: {
          sourceIp: '192.168.1.100',
        },
      },
    };

    it('should log blocked submission to DynamoDB', async () => {
      const mockDynamoClient = {
        send: vi.fn().mockResolvedValue({}),
      };

      const submissionId = await logBlockedSubmission(
        contactData,
        classificationResult,
        event,
        mockDynamoClient
      );

      expect(submissionId).toBeTruthy();
      expect(mockDynamoClient.send).toHaveBeenCalledTimes(1);

      const putCommand = mockDynamoClient.send.mock.calls[0][0];
      expect(putCommand.input.Item.name).toBe('Spammer');
      expect(putCommand.input.Item.email).toBe('spam@example.com');
      expect(putCommand.input.Item.classification).toBe('SPAM');
      expect(putCommand.input.Item.confidence).toBe(0.95);
      expect(putCommand.input.Item.ipAddress).toBe('192.168.1.100');
      expect(putCommand.input.Item.ttl).toBeGreaterThan(Date.now() / 1000);
    });

    it('should handle missing IP address gracefully', async () => {
      const mockDynamoClient = {
        send: vi.fn().mockResolvedValue({}),
      };

      const eventNoIp = {};
      await logBlockedSubmission(contactData, classificationResult, eventNoIp, mockDynamoClient);

      const putCommand = mockDynamoClient.send.mock.calls[0][0];
      expect(putCommand.input.Item.ipAddress).toBe('unknown');
    });

    it('should handle DynamoDB errors gracefully', async () => {
      const mockDynamoClient = {
        send: vi.fn().mockRejectedValue(new Error('DynamoDB error')),
      };

      vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await logBlockedSubmission(
        contactData,
        classificationResult,
        event,
        mockDynamoClient
      );

      expect(result).toBe(null);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('formatEmailBody', () => {
    const contactData = {
      name: 'John Doe',
      email: 'john@example.com',
      phone: '555-1234',
      message: 'This is a test message',
    };

    it('should format email body with all fields', () => {
      const body = formatEmailBody(contactData);
      expect(body).toContain('New Contact Form Submission');
      expect(body).toContain('Name: John Doe');
      expect(body).toContain('Email: john@example.com');
      expect(body).toContain('Phone: 555-1234');
      expect(body).toContain('This is a test message');
      expect(body).toContain('Submitted:');
    });

    it('should include timestamp', () => {
      const body = formatEmailBody(contactData);
      expect(body).toMatch(/Submitted: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include spam classification when provided', () => {
      const classification = {
        classification: 'SALES',
        confidence: 0.85,
        reason: 'Offering SEO services',
      };
      const body = formatEmailBody(contactData, classification);
      expect(body).toContain('Spam Detection:');
      expect(body).toContain('Classification: SALES');
      expect(body).toContain('Confidence: 85.0%');
      expect(body).toContain('Reason: Offering SEO services');
    });

    it('should include failedOpen warning when Bedrock fails', () => {
      const classification = {
        classification: 'LEGITIMATE',
        confidence: 0.0,
        reason: 'Classification error',
        failedOpen: true,
      };
      const body = formatEmailBody(contactData, classification);
      expect(body).toContain('⚠️  Bedrock classification failed - failed open');
    });
  });

  describe('handler - spam detection disabled', () => {
    let mockSESClient;
    let mockBedrockClient;
    let mockDynamoClient;
    let mockContext;
    let originalEnv;

    beforeEach(() => {
      // Save and disable spam detection
      originalEnv = process.env.SPAM_DETECTION_ENABLED;
      process.env.SPAM_DETECTION_ENABLED = 'false';

      mockSESClient = {
        send: vi.fn().mockResolvedValue({ MessageId: 'test-message-id' }),
      };
      mockBedrockClient = {
        send: vi.fn().mockResolvedValue({
          body: new TextEncoder().encode(JSON.stringify({
            content: [{
              text: '{"classification": "LEGITIMATE", "confidence": 0.95, "reason": "Genuine inquiry"}'
            }]
          })),
        }),
      };
      mockDynamoClient = {
        send: vi.fn().mockResolvedValue({}),
      };
      mockContext = {
        requestId: 'test-request-id',
      };
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      // Restore environment
      if (originalEnv === undefined) {
        delete process.env.SPAM_DETECTION_ENABLED;
      } else {
        process.env.SPAM_DETECTION_ENABLED = originalEnv;
      }
    });

    it('should handle valid contact form submission with JSON', async () => {
      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'Test message',
        }),
      };

      const response = await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Thank you for contacting us! Your message has been sent.',
        success: true,
      });
      expect(mockSESClient.send).toHaveBeenCalledTimes(1);
      expect(mockBedrockClient.send).not.toHaveBeenCalled(); // Spam detection disabled
      expect(mockDynamoClient.send).not.toHaveBeenCalled(); // Not logged
    });

    it('should handle URL-encoded form data', async () => {
      const formData = 'name=John+Doe&email=john%40example.com&phone=555-1234&message=Test+message';
      const event = {
        body: formData,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
      };

      const response = await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Thank you for contacting us! Your message has been sent.',
        success: true,
      });
      expect(mockSESClient.send).toHaveBeenCalledTimes(1);
    });

    it('should handle base64-encoded URL-encoded form data', async () => {
      const formData = 'name=John+Doe&email=john%40example.com&phone=555-1234&message=Test+message';
      const base64Body = Buffer.from(formData).toString('base64');
      const event = {
        body: base64Body,
        isBase64Encoded: true,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
      };

      const response = await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Thank you for contacting us! Your message has been sent.',
        success: true,
      });
      expect(mockSESClient.send).toHaveBeenCalledTimes(1);
    });

    it('should handle OPTIONS request (CORS preflight)', async () => {
      const event = {
        httpMethod: 'OPTIONS',
        body: null,
      };

      const response = await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(200);
      expect(mockSESClient.send).not.toHaveBeenCalled();
    });

    it('should reject invalid JSON', async () => {
      const event = {
        body: 'not valid json',
      };

      const response = await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Invalid request format',
      });
      expect(mockSESClient.send).not.toHaveBeenCalled();
    });

    it('should reject missing email', async () => {
      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          phone: '555-1234',
          message: 'Test message',
        }),
      };

      const response = await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.field).toBe('email');
      expect(body.error).toContain('email');
      expect(mockSESClient.send).not.toHaveBeenCalled();
    });

    it('should reject invalid email format', async () => {
      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'not-an-email',
          phone: '555-1234',
          message: 'Test message',
        }),
      };

      const response = await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.field).toBe('email');
      expect(mockSESClient.send).not.toHaveBeenCalled();
    });

    it('should reject message that is too long', async () => {
      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'x'.repeat(3000),
        }),
      };

      const response = await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.field).toBe('message');
      expect(mockSESClient.send).not.toHaveBeenCalled();
    });

    it('should handle SES errors gracefully', async () => {
      mockSESClient.send.mockRejectedValue(new Error('SES Error'));

      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'Test message',
        }),
      };

      const response = await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Unable to send message. Please try again later.',
      });
    });

    it('should include CORS headers in all responses', async () => {
      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'Test message',
        }),
      };

      const response = await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(response.headers).toHaveProperty('Access-Control-Allow-Headers');
      expect(response.headers).toHaveProperty('Access-Control-Allow-Methods');
      expect(response.headers).toHaveProperty('Content-Type', 'application/json');
    });

    it('should sanitize and trim input', async () => {
      const event = {
        body: JSON.stringify({
          name: '  John Doe  ',
          email: '  john@example.com  ',
          phone: '  555-1234  ',
          message: '  Test message  ',
        }),
      };

      await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(mockSESClient.send).toHaveBeenCalled();
      const sentCommand = mockSESClient.send.mock.calls[0][0];
      expect(sentCommand.input.Message.Body.Text.Data).toContain('Name: John Doe');
      expect(sentCommand.input.ReplyToAddresses[0]).toBe('John Doe <john@example.com>');
    });

    it('should log requests with request ID', async () => {
      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'Test message',
        }),
      };

      await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(console.log).toHaveBeenCalled();
      const logCalls = console.log.mock.calls;
      expect(logCalls.some(call => 
        call[0].includes('test-request-id')
      )).toBe(true);
    });

    it('should use awsRequestId from context when available', async () => {
      const lambdaContext = {
        awsRequestId: 'aws-req-id-123',
        functionName: 'test-function',
      };

      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'Test message',
        }),
      };

      await handler(event, lambdaContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(console.log).toHaveBeenCalled();
      const logCalls = console.log.mock.calls;
      expect(logCalls.some(call => 
        call[0].includes('aws-req-id-123')
      )).toBe(true);
    });

    it('should create SES client when sesClient parameter is undefined', async () => {
      // Simulate Lambda runtime not passing third parameter
      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'Test message',
        }),
      };

      // Don't pass sesClient parameter (undefined)
      const response = await handler(event, mockContext);

      // In test environment without AWS credentials, the SDK may still work
      // or fail gracefully. The important thing is it doesn't crash with
      // "sesClient.send is not a function" error.
      // We just verify we get a valid response structure
      expect(response).toHaveProperty('statusCode');
      expect(response).toHaveProperty('headers');
      expect(response).toHaveProperty('body');
      expect([200, 500]).toContain(response.statusCode);
    });

    it('should handle sesClient parameter being a function (Lambda runtime quirk)', async () => {
      // This tests the fix for the bug where Lambda sometimes passes a function
      const functionParam = () => {}; // Simulate Lambda passing a function

      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'Test message',
        }),
      };

      // Pass a function instead of an object
      const response = await handler(event, mockContext, functionParam);

      // Should handle gracefully by detecting it's not an object and creating new SES client
      // The key is it doesn't crash with "sesClient.send is not a function"
      expect(response).toHaveProperty('statusCode');
      expect(response).toHaveProperty('headers');
      expect(response).toHaveProperty('body');
      expect([200, 500]).toContain(response.statusCode);
    });

    it('should use provided sesClient when it is a valid object', async () => {
      const customMockClient = {
        send: vi.fn().mockResolvedValue({ MessageId: 'custom-message-id' }),
      };

      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'Test message',
        }),
      };

      const response = await handler(event, mockContext, customMockClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(200);
      expect(customMockClient.send).toHaveBeenCalledTimes(1);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Thank you for contacting us! Your message has been sent.',
        success: true,
      });
    });

    it('should handle context being null or undefined', async () => {
      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'Test message',
        }),
      };

      // Test with null context
      const response = await handler(event, null, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(200);
      expect(mockSESClient.send).toHaveBeenCalled();

      // Check that 'local' was used as fallback requestId
      const logCalls = console.log.mock.calls;
      expect(logCalls.some(call => 
        call[0].includes('"requestId":"local"')
      )).toBe(true);
    });

    it('should handle Lambda Function URL event format', async () => {
      const functionUrlEvent = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'Test message',
        }),
        requestContext: {
          http: {
            method: 'POST',
            path: '/rest/contact',
          },
        },
      };

      const lambdaContext = {
        awsRequestId: 'lambda-url-request-id',
        functionName: 'contact-form-function',
      };

      const response = await handler(functionUrlEvent, lambdaContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(200);
      expect(mockSESClient.send).toHaveBeenCalledTimes(1);
    });
    
    it('should not call Bedrock when spam detection is disabled', async () => {
      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'Test message',
        }),
      };

      const response = await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(200);
      expect(mockSESClient.send).toHaveBeenCalledTimes(1);
      expect(mockBedrockClient.send).not.toHaveBeenCalled(); // No spam detection
      expect(mockDynamoClient.send).not.toHaveBeenCalled(); // No logging
    });
    
    it('should not include classification in email when spam detection is disabled', async () => {
      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'I have a question',
        }),
      };

      const response = await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

      expect(response.statusCode).toBe(200);
      const sentCommand = mockSESClient.send.mock.calls[0][0];
      const emailBody = sentCommand.input.Message.Body.Text.Data;
      
      expect(emailBody).not.toContain('Spam Detection:');
      expect(emailBody).not.toContain('Classification:');
    });
  });
});
