const fetch = require('node-fetch');

class Validator {
  // Validate email format
  static validateEmailFormat(email) {
    if (!email) return false;
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  }

  // Validate phone format
  static validatePhoneFormat(phone) {
    if (!phone) return false;
    const regex = /^[\d\+\-\s\(\)]{10,}$/;
    return regex.test(phone);
  }

  // Check if email domain exists (DNS validation)
  static async validateEmailDomain(email) {
    try {
      if (!email) return false;
      const domain = email.split('@')[1];
      
      // Use free DNS validation API
      const response = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`);
      const data = await response.json();
      
      return data.Answer && data.Answer.length > 0;
    } catch (error) {
      console.error('Email domain validation error:', error);
      return null; // Unable to verify
    }
  }

  // Check if email is disposable
  static async isDisposableEmail(email) {
    try {
      if (!email) return false;
      
      const disposableDomains = [
        'tempmail.com', 'guerrillamail.com', '10minutemail.com', 
        'throwaway.email', 'mailinator.com', 'sharklasers.com'
      ];
      
      const domain = email.split('@')[1];
      return disposableDomains.includes(domain);
    } catch (error) {
      return false;
    }
  }

  // Comprehensive email validation
  static async validateEmail(email) {
    try {
      // Format check
      if (!this.validateEmailFormat(email)) {
        return { email, valid: false, reason: 'Invalid format' };
      }

      // Disposable check
      if (await this.isDisposableEmail(email)) {
        return { email, valid: false, reason: 'Disposable email' };
      }

      // Domain check (free)
      const domainValid = await this.validateEmailDomain(email);
      if (domainValid === false) {
        return { email, valid: false, reason: 'Domain not found' };
      }

      // If we get here, email is likely valid
      return { email, valid: true, reason: 'Valid', confidence: 0.8 };

    } catch (error) {
      console.error('Email validation error:', error);
      return { email, valid: null, reason: 'Unable to validate' };
    }
  }

  // Validate phone
  static validatePhone(phone) {
    try {
      if (!this.validatePhoneFormat(phone)) {
        return { phone, valid: false, reason: 'Invalid format' };
      }

      // Basic checks
      const cleaned = phone.replace(/\D/g, '');
      if (cleaned.length < 10) {
        return { phone, valid: false, reason: 'Too short' };
      }

      return { phone, valid: true, reason: 'Valid format' };

    } catch (error) {
      return { phone, valid: false, reason: 'Error' };
    }
  }

  // Batch validation of leads
  static async validateLeads(leads) {
    try {
      const validated = [];

      for (const lead of leads) {
        const emailValidation = await this.validateEmail(lead.email);
        const phoneValidation = this.validatePhone(lead.phone);

        validated.push({
          ...lead,
          email_valid: emailValidation.valid,
          email_confidence: emailValidation.confidence || 0,
          phone_valid: phoneValidation.valid,
          email_reason: emailValidation.reason,
          phone_reason: phoneValidation.reason,
          contactable: emailValidation.valid || phoneValidation.valid
        });
      }

      return validated;

    } catch (error) {
      console.error('Batch validation error:', error);
      return leads;
    }
  }

  // Check if website is reachable
  static async validateWebsite(website) {
    try {
      if (!website) return false;
      
      const response = await fetch(website, { timeout: 5000, redirect: 'follow' });
      return response.status >= 200 && response.status < 400;
    } catch (error) {
      return false;
    }
  }

  // LinkedIn URL validation
  static validateLinkedInURL(url) {
    if (!url) return false;
    return /linkedin\.com\/in\/|linkedin\.com\/company\//.test(url);
  }

  // Verify lead is high quality
  static isHighQualityLead(lead) {
    let score = 0;

    // Contact info
    if (lead.email_valid) score += 30;
    if (lead.phone_valid) score += 25;
    if (lead.website) score += 20;

    // Enrichment
    if (lead.linkedin) score += 15;
    if (lead.jobTitle) score += 10;
    if (lead.company) score += 10;

    // Additional
    if (lead.verified) score += 5;
    if (lead.rating && lead.rating >= 4) score += 5;

    return score >= 60; // 60+ = high quality
  }
}

module.exports = Validator;