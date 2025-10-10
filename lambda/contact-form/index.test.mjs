import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handler,
  validateField,
  validateContactForm,
  generateSubject,
  formatEmailBody,
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
      expect(generateSubject('Hello    world   test')).toBe('Hello world test');
    });

    it('should trim leading/trailing whitespace', () => {
      expect(generateSubject('  Hello world  ')).toBe('Hello world');
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
  });

  describe('handler', () => {
    let mockSESClient;
    let mockContext;

    beforeEach(() => {
      mockSESClient = {
        send: vi.fn().mockResolvedValue({ MessageId: 'test-message-id' }),
      };
      mockContext = {
        requestId: 'test-request-id',
      };
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('should handle valid contact form submission', async () => {
      const event = {
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '555-1234',
          message: 'Test message',
        }),
      };

      const response = await handler(event, mockContext, mockSESClient);

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

      const response = await handler(event, mockContext, mockSESClient);

      expect(response.statusCode).toBe(200);
      expect(mockSESClient.send).not.toHaveBeenCalled();
    });

    it('should reject invalid JSON', async () => {
      const event = {
        body: 'not valid json',
      };

      const response = await handler(event, mockContext, mockSESClient);

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

      const response = await handler(event, mockContext, mockSESClient);

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

      const response = await handler(event, mockContext, mockSESClient);

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

      const response = await handler(event, mockContext, mockSESClient);

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

      const response = await handler(event, mockContext, mockSESClient);

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

      const response = await handler(event, mockContext, mockSESClient);

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

      await handler(event, mockContext, mockSESClient);

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

      await handler(event, mockContext, mockSESClient);

      expect(console.log).toHaveBeenCalled();
      const logCalls = console.log.mock.calls;
      expect(logCalls.some(call => 
        call[0].includes('test-request-id')
      )).toBe(true);
    });
  });
});
