import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './index.mjs';

describe('Contact Form Lambda - Spam Detection ENABLED', () => {
  let mockSESClient;
  let mockBedrockClient;
  let mockDynamoClient;
  let mockContext;

  beforeEach(() => {
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

  it('should block high-confidence spam and return 200 OK', async () => {
    const spamBedrockClient = {
      send: vi.fn().mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          content: [{
            text: '{"classification": "SPAM", "confidence": 0.95, "reason": "Phishing attempt"}'
          }]
        })),
      }),
    };

    const event = {
      body: JSON.stringify({
        name: 'Spammer',
        email: 'spam@example.com',
        phone: '555-9999',
        message: 'Click here for free money!',
      }),
      requestContext: {
        http: {
          sourceIp: '192.168.1.100',
        },
      },
    };

    const response = await handler(event, mockContext, mockSESClient, spamBedrockClient, mockDynamoClient);

    expect(response.statusCode).toBe(200); // Always 200 OK
    expect(JSON.parse(response.body)).toEqual({
      message: 'Thank you for contacting us! Your message has been sent.',
      success: true,
    });
    expect(mockSESClient.send).not.toHaveBeenCalled(); // Email NOT sent
    expect(mockDynamoClient.send).toHaveBeenCalledTimes(1); // Logged to DynamoDB
  });

  it('should block high-confidence gibberish and log to DynamoDB', async () => {
    const gibberishBedrockClient = {
      send: vi.fn().mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          content: [{
            text: '{"classification": "GIBBERISH", "confidence": 0.99, "reason": "Random characters"}'
          }]
        })),
      }),
    };

    const event = {
      body: JSON.stringify({
        name: 'asdfgh',
        email: 'test@example.com',
        phone: '555-1234',
        message: 'asdkjfh alksjdhf lkajsdhf',
      }),
    };

    const response = await handler(event, mockContext, mockSESClient, gibberishBedrockClient, mockDynamoClient);

    expect(response.statusCode).toBe(200);
    expect(mockSESClient.send).not.toHaveBeenCalled();
    expect(mockDynamoClient.send).toHaveBeenCalledTimes(1);
  });

  it('should send email for low-confidence spam', async () => {
    const lowConfidenceBedrockClient = {
      send: vi.fn().mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          content: [{
            text: '{"classification": "SPAM", "confidence": 0.5, "reason": "Uncertain"}'
          }]
        })),
      }),
    };

    const event = {
      body: JSON.stringify({
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-1234',
        message: 'Maybe spam?',
      }),
    };

    const response = await handler(event, mockContext, mockSESClient, lowConfidenceBedrockClient, mockDynamoClient);

    expect(response.statusCode).toBe(200);
    expect(mockSESClient.send).toHaveBeenCalledTimes(1); // Email sent despite SPAM classification
    expect(mockDynamoClient.send).not.toHaveBeenCalled(); // Not logged (below threshold)
  });

  it('should send email for SALES classification (not blocked)', async () => {
    const salesBedrockClient = {
      send: vi.fn().mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          content: [{
            text: '{"classification": "SALES", "confidence": 0.95, "reason": "SEO pitch"}'
          }]
        })),
      }),
    };

    const event = {
      body: JSON.stringify({
        name: 'SEO Company',
        email: 'sales@seo.com',
        phone: '555-8888',
        message: 'We can improve your Google rankings!',
      }),
    };

    const response = await handler(event, mockContext, mockSESClient, salesBedrockClient, mockDynamoClient);

    expect(response.statusCode).toBe(200);
    expect(mockSESClient.send).toHaveBeenCalledTimes(1); // Email sent (SALES not blocked)
    expect(mockDynamoClient.send).not.toHaveBeenCalled(); // Not logged
    
    // Subject should have sus emoji
    const sentCommand = mockSESClient.send.mock.calls[0][0];
    expect(sentCommand.input.Message.Subject.Data).toContain('🤨');
  });

  it('should include classification in email body for legitimate submissions', async () => {
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
    
    expect(emailBody).toContain('Spam Detection:');
    expect(emailBody).toContain('Classification: LEGITIMATE');
    expect(emailBody).toContain('Confidence: 95.0%');
  });

  it('should handle Bedrock failure with fail-open', async () => {
    const failingBedrockClient = {
      send: vi.fn().mockRejectedValue(new Error('Bedrock unavailable')),
    };

    const event = {
      body: JSON.stringify({
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-1234',
        message: 'Test message',
      }),
    };

    const response = await handler(event, mockContext, mockSESClient, failingBedrockClient, mockDynamoClient);

    expect(response.statusCode).toBe(200);
    expect(mockSESClient.send).toHaveBeenCalledTimes(1); // Email sent (fail-open)
    expect(mockDynamoClient.send).not.toHaveBeenCalled();
    
    // Email should include fail-open warning
    const sentCommand = mockSESClient.send.mock.calls[0][0];
    const emailBody = sentCommand.input.Message.Body.Text.Data;
    expect(emailBody).toContain('⚠️  Bedrock classification failed - failed open');
  });

  it('should always return 200 OK even when blocking spam', async () => {
    const spamBedrockClient = {
      send: vi.fn().mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          content: [{
            text: '{"classification": "SPAM", "confidence": 1.0, "reason": "Obvious spam"}'
          }]
        })),
      }),
    };

    const event = {
      body: JSON.stringify({
        name: 'Spammer',
        email: 'spam@bad.com',
        phone: '555-0000',
        message: 'SPAM SPAM SPAM',
      }),
    };

    const response = await handler(event, mockContext, mockSESClient, spamBedrockClient, mockDynamoClient);

    // Always 200 to avoid revealing detection mechanism
    expect(response.statusCode).toBe(200);
    expect(response.headers).toHaveProperty('Access-Control-Allow-Origin');
    expect(JSON.parse(response.body)).toEqual({
      message: 'Thank you for contacting us! Your message has been sent.',
      success: true,
    });
  });

  it('should handle DynamoDB logging failure gracefully', async () => {
    const spamBedrockClient = {
      send: vi.fn().mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          content: [{
            text: '{"classification": "SPAM", "confidence": 0.95, "reason": "Spam"}'
          }]
        })),
      }),
    };

    const failingDynamoClient = {
      send: vi.fn().mockRejectedValue(new Error('DynamoDB error')),
    };

    const event = {
      body: JSON.stringify({
        name: 'Spammer',
        email: 'spam@example.com',
        phone: '555-9999',
        message: 'Spam message',
      }),
    };

    const response = await handler(event, mockContext, mockSESClient, spamBedrockClient, failingDynamoClient);

    // Should still return 200 and block the email
    expect(response.statusCode).toBe(200);
    expect(mockSESClient.send).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled(); // DynamoDB error logged
  });

  it('should call Bedrock for all submissions when enabled', async () => {
    const event = {
      body: JSON.stringify({
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-1234',
        message: 'Test message',
      }),
    };

    await handler(event, mockContext, mockSESClient, mockBedrockClient, mockDynamoClient);

    expect(mockBedrockClient.send).toHaveBeenCalledTimes(1); // Bedrock called
  });
});
