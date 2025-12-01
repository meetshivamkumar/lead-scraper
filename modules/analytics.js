const fetch = require('node-fetch');

class Analytics {
  // Score leads specifically for cold email outreach
  static async scoreForColdEmail(leads, params = {}) {
    try {
      return leads.map(lead => {
        let score = 0;
        let factors = [];

        // Contact Availability (30%)
        if (lead.email_valid) {
          score += 20;
          factors.push('Valid Email');
        } else if (lead.email) {
          score += 10;
          factors.push('Unverified Email');
        }

        if (lead.phone_valid) {
          score += 10;
          factors.push('Valid Phone');
        }

        // Enrichment (25%)
        if (lead.linkedin) {
          score += 10;
          factors.push('LinkedIn Profile');
        }

        if (lead.jobTitle && (
          lead.jobTitle.includes('CEO') || 
          lead.jobTitle.includes('Founder') ||
          lead.jobTitle.includes('Director') ||
          lead.jobTitle.includes('Manager')
        )) {
          score += 8;
          factors.push('Decision Maker');
        } else if (lead.jobTitle) {
          score += 4;
          factors.push('Job Title Known');
        }

        if (lead.company) {
          score += 3;
          factors.push('Company Info');
        }

        // Business Signals (25%)
        if (lead.website && lead.quality_score >= 0.8) {
          score += 10;
          factors.push('Professional Website');
        }

        if (lead.verified || lead.rating >= 4) {
          score += 8;
          factors.push('Verified Business');
        }

        if (lead.industry && ['saas', 'tech', 'finance', 'ecommerce'].includes(lead.industry.toLowerCase())) {
          score += 7;
          factors.push('High-Value Industry');
        }

        // Responsiveness Indicators (20%)
        if (lead.opening_hours) {
          score += 5;
          factors.push('Active Hours Listed');
        }

        if (lead.distance && lead.distance < 5) {
          score += 5;
          factors.push('Local (Nearby)');
        }

        // Normalize to 0-10 scale
        const normalizedScore = Math.min((score / 100) * 10, 10);

        return {
          ...lead,
          coldEmail_score: parseFloat(normalizedScore.toFixed(2)),
          scoreFactors: factors,
          responseLikelihood: this.estimateResponseRate(normalizedScore),
          outreachPriority: this.getPriority(normalizedScore)
        };
      });

    } catch (error) {
      console.error('Scoring error:', error);
      return leads;
    }
  }

  // Estimate response rate
  static estimateResponseRate(score) {
    if (score >= 8.5) return 0.25; // 25% response rate
    if (score >= 7.5) return 0.18; // 18%
    if (score >= 6.5) return 0.12; // 12%
    if (score >= 5.5) return 0.08; // 8%
    return 0.03; // 3%
  }

  // Get priority level
  static getPriority(score) {
    if (score >= 8.5) return 'URGENT';
    if (score >= 7) return 'HIGH';
    if (score >= 5.5) return 'MEDIUM';
    return 'LOW';
  }

  // Get detailed statistics
  static getDetailedStats(leads) {
    const stats = {
      total: leads.length,
      validEmails: leads.filter(l => l.email_valid).length,
      validPhones: leads.filter(l => l.phone_valid).length,
      hasLinkedIn: leads.filter(l => l.linkedin).length,
      hasCompany: leads.filter(l => l.company).length,
      hasJobTitle: leads.filter(l => l.jobTitle).length,
      highQuality: leads.filter(l => l.coldEmail_score >= 8).length,
      mediumQuality: leads.filter(l => l.coldEmail_score >= 5.5 && l.coldEmail_score < 8).length,
      lowQuality: leads.filter(l => l.coldEmail_score < 5.5).length,
      avgColdEmailScore: leads.reduce((sum, l) => sum + (l.coldEmail_score || 0), 0) / leads.length || 0,
      responseLikelihood: Math.round(
        leads.reduce((sum, l) => sum + (l.responseLikelihood || 0), 0) / leads.length * 100
      ),
      estimatedValue: this.estimateValue(leads),
      byIndustry: this.groupByIndustry(leads),
      topJobTitles: this.getTopJobTitles(leads),
      bySource: this.groupBySource(leads)
    };

    return stats;
  }

  // Estimate total value of leads
  static estimateValue(leads) {
    let value = 0;

    leads.forEach(lead => {
      const baseValue = 50; // $50 per lead
      
      // Multipliers
      if (lead.coldEmail_score >= 8) value += baseValue * 3;
      else if (lead.coldEmail_score >= 7) value += baseValue * 2;
      else if (lead.coldEmail_score >= 5.5) value += baseValue * 1.5;
      else value += baseValue;
    });

    return Math.round(value);
  }

  // Group by industry
  static groupByIndustry(leads) {
    const industries = {};

    leads.forEach(lead => {
      const industry = lead.industry || 'Unknown';
      industries[industry] = (industries[industry] || 0) + 1;
    });

    return industries;
  }

  // Get top job titles
  static getTopJobTitles(leads) {
    const titles = {};

    leads.forEach(lead => {
      const title = lead.jobTitle || 'N/A';
      titles[title] = (titles[title] || 0) + 1;
    });

    return Object.entries(titles)
      .sort((a, b) => b[1] - a[1])
      .map(([title, count]) => `${title} (${count})`);
  }

  // Group by source
  static groupBySource(leads) {
    const sources = {};

    leads.forEach(lead => {
      const source = lead.source || 'Unknown';
      sources[source] = (sources[source] || 0) + 1;
    });

    return sources;
  }

  // Generate cold email templates
  static generateColdEmailTemplates(leads) {
    const templates = [];

    leads.slice(0, 5).forEach((lead, index) => {
      const template = this.generateEmailTemplate(lead, index + 1);
      templates.push(template);
    });

    return templates;
  }

  // Generate single email template
  static generateEmailTemplate(lead, number) {
    const jobTitle = lead.jobTitle || 'there';
    const company = lead.company || 'your company';
    const name = lead.name ? lead.name.split(' ')[0] : 'friend';

    let subject = '';
    let body = '';

    // Personalized subject line
    const subjects = [
      `${name}, quick question about ${company}`,
      `${company}'s ${jobTitle.toLowerCase()} opportunity`,
      `Help needed for ${company}'s growth`,
      `${name} - potential partnership?`,
      `Question for ${company}'s ${jobTitle.toLowerCase()}`
    ];

    subject = subjects[number % subjects.length];

    // Personalized body
    body = `Hi ${name},

I noticed you're a ${jobTitle} at ${company}. I was impressed by [specific achievement/reason].

I work with [similar companies] to [solve specific problem]. Given your background, I thought you might find this valuable.

Quick question: Are you currently looking at [specific area]?

If it's relevant, I'd love to share a quick 15-min call.

Best,
[Your Name]`;

    return {
      leadName: lead.name,
      leadScore: (lead.coldEmail_score || 0).toFixed(1),
      subject: subject,
      body: body,
      tips: [
        '✅ Personalize with specific achievement',
        '✅ Keep body under 100 words',
        '✅ Ask a specific question',
        '✅ Include clear CTA',
        `✅ Best time: ${this.getBestSendTime()}`
      ]
    };
  }

  // Best time to send emails
  static getBestSendTime() {
    const times = ['Tuesday 10am', 'Wednesday 2pm', 'Thursday 9am', 'Tuesday 3pm'];
    return times[Math.floor(Math.random() * times.length)];
  }

  // Predict conversion rate
  static predictConversionRate(lead) {
    let likelihood = 0.01; // 1% base

    if (lead.coldEmail_score >= 8.5) likelihood = 0.12;
    else if (lead.coldEmail_score >= 7.5) likelihood = 0.08;
    else if (lead.coldEmail_score >= 6.5) likelihood = 0.05;
    else if (lead.coldEmail_score >= 5.5) likelihood = 0.03;

    // Adjustments
    if (lead.email_valid) likelihood *= 1.3;
    if (lead.linkedin) likelihood *= 1.2;
    if (lead.verified) likelihood *= 1.15;

    return Math.min(likelihood, 0.3); // Cap at 30%
  }

  // Lead health score
  static getLeadHealthScore(lead) {
    let health = 0;

    // Contact info (40%)
    if (lead.email && lead.email_valid) health += 40;
    else if (lead.email) health += 20;

    // Professional signals (35%)
    if (lead.linkedin) health += 15;
    if (lead.jobTitle) health += 10;
    if (lead.company) health += 10;

    // Business indicators (25%)
    if (lead.website) health += 15;
    if (lead.verified) health += 10;

    return Math.min(health, 100);
  }

  // Segment leads by quality tiers
  static segmentByTier(leads) {
    return {
      tier1: leads.filter(l => l.coldEmail_score >= 8.5), // Top 20%
      tier2: leads.filter(l => l.coldEmail_score >= 7 && l.coldEmail_score < 8.5), // Mid 40%
      tier3: leads.filter(l => l.coldEmail_score >= 5.5 && l.coldEmail_score < 7), // Lower 30%
      tier4: leads.filter(l => l.coldEmail_score < 5.5) // Bottom 10%
    };
  }

  // Identify high-priority leads for immediate outreach
  static getPriorityLeads(leads, limit = 10) {
    return leads
      .filter(l => l.email_valid && l.coldEmail_score >= 7)
      .sort((a, b) => b.coldEmail_score - a.coldEmail_score)
      .slice(0, limit)
      .map(l => ({
        ...l,
        outreachTemplate: 'urgent',
        followUpFrequency: '2 days'
      }));
  }

  // Calculate risk score (likelihood of bouncing/unsubscribe)
  static calculateRiskScore(lead) {
    let risk = 0;

    // No email = high risk
    if (!lead.email) risk += 50;
    else if (!lead.email_valid) risk += 30;

    // Generic email addresses
    if (lead.email && ['info@', 'hello@', 'support@'].some(prefix => lead.email.startsWith(prefix))) {
      risk += 20;
    }

    // Unverified business
    if (!lead.verified) risk += 15;

    // No contact info at all
    if (!lead.phone && !lead.linkedin) risk += 10;

    return Math.min(risk, 100);
  }
}

module.exports = Analytics;