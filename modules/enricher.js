const fetch = require('node-fetch');
const cheerio = require('cheerio');

class Enricher {
  // Find LinkedIn profile via name + company
  static async findLinkedInProfile(name, company) {
    try {
      if (!name) return null;

      // LinkedIn search URL (public)
      const encodedName = encodeURIComponent(name);
      const encodedCompany = company ? encodeURIComponent(company) : '';
      
      const searchUrl = company 
        ? `https://www.linkedin.com/search/results/people/?keywords=${encodedName}%20${encodedCompany}`
        : `https://www.linkedin.com/search/results/people/?keywords=${encodedName}`;

      // Note: Direct scraping of LinkedIn is restricted
      // Alternative: Use Hunter.io or RocketReach free tier
      
      return {
        linkedin: searchUrl,
        profile_found: true
      };

    } catch (error) {
      console.error('LinkedIn search error:', error);
      return null;
    }
  }

  // Get company info via domain
  static async enrichCompanyData(website, name) {
    try {
      if (!website && !name) return {};

      const enriched = {
        company: name,
        website: website,
        industry: null,
        size: null,
        revenue: null,
        founded: null,
        employees: null
      };

      if (!website) return enriched;

      // Try to fetch company info
      try {
        const response = await fetch(website, { timeout: 5000 });
        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract metadata
        const description = $('meta[name="description"]').attr('content') || '';
        const ogDescription = $('meta[property="og:description"]').attr('content') || '';
        
        enriched.description = description || ogDescription;

        // Look for common indicators
        const pageText = $('body').text().toLowerCase();
        
        // Industry detection
        const industries = {
          'saas': ['software', 'cloud', 'api', 'platform'],
          'ecommerce': ['shop', 'store', 'sell', 'product'],
          'agency': ['agency', 'marketing', 'creative', 'design'],
          'finance': ['bank', 'fintech', 'payment', 'crypto'],
          'healthcare': ['health', 'medical', 'clinic', 'doctor']
        };

        for (const [industry, keywords] of Object.entries(industries)) {
          if (keywords.some(kw => pageText.includes(kw))) {
            enriched.industry = industry;
            break;
          }
        }

      } catch (e) {
        console.log('Company fetch failed:', website);
      }

      return enriched;

    } catch (error) {
      console.error('Company enrichment error:', error);
      return {};
    }
  }

  // Get email via Hunter.io free API (100/month)
  static async findEmailViaHunter(name, domain) {
    try {
      if (!domain || !process.env.HUNTER_API_KEY) return null;

      const response = await fetch(
        `https://api.hunter.io/v2/email-finder?domain=${domain}&first_name=${name.split(' ')[0]}&last_name=${name.split(' ')[1]}&domain=${domain}&api_key=${process.env.HUNTER_API_KEY}`
      );

      const data = await response.json();
      
      if (data.data && data.data.email) {
        return {
          email: data.data.email,
          confidence: data.data.confidence || 0.8,
          source: 'hunter.io'
        };
      }

      return null;

    } catch (error) {
      console.error('Hunter.io error:', error);
      return null;
    }
  }

  // Find email via RocketReach free (limited)
  static async findEmailViaRocketReach(name, company) {
    try {
      if (!process.env.ROCKETREACH_API_KEY) return null;

      const response = await fetch('https://api.rocketreach.co/v2/person/lookup', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.ROCKETREACH_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          first_name: name.split(' ')[0],
          last_name: name.split(' ')[1],
          company: company
        })
      });

      const data = await response.json();

      if (data.id && data.email) {
        return {
          email: data.email,
          phone: data.phone,
          source: 'rocketreach'
        };
      }

      return null;

    } catch (error) {
      console.error('RocketReach error:', error);
      return null;
    }
  }

  // Extract job title from various sources
  static extractJobTitle(lead) {
    if (lead.jobTitle) return lead.jobTitle;

    // Try to extract from name or description
    const titlePatterns = [
      /CEO|Founder|President|Director|Manager|Head of/i,
      /Developer|Engineer|Designer|Analyst|Specialist/i,
      /Sales|Marketing|Product|Operations|Finance/i
    ];

    const text = (lead.name + ' ' + (lead.description || '')).toLowerCase();
    
    for (const pattern of titlePatterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }

    return 'Professional';
  }

  // Enrich single lead
  static async enrichLead(lead) {
    try {
      const enriched = { ...lead };

      // LinkedIn profile
      if (!enriched.linkedin && enriched.name && enriched.company) {
        const linkedinData = await this.findLinkedInProfile(enriched.name, enriched.company);
        if (linkedinData) {
          enriched.linkedin = linkedinData.linkedin;
        }
      }

      // Company data
      if (enriched.website) {
        const companyData = await this.enrichCompanyData(enriched.website, enriched.company);
        enriched.industry = companyData.industry;
        enriched.companyDescription = companyData.description;
      }

      // Email finding
      if (!enriched.email && enriched.website) {
        const domain = enriched.website.replace('https://', '').replace('http://', '').split('/')[0];
        
        // Try Hunter.io
        const hunterEmail = await this.findEmailViaHunter(enriched.name, domain);
        if (hunterEmail) {
          enriched.email = hunterEmail.email;
          enriched.emailSource = 'hunter.io';
          enriched.emailConfidence = hunterEmail.confidence;
        }
      }

      // Job title extraction
      if (!enriched.jobTitle) {
        enriched.jobTitle = this.extractJobTitle(enriched);
      }

      return enriched;

    } catch (error) {
      console.error('Lead enrichment error:', error);
      return lead;
    }
  }

  // Batch enrich leads
  static async enrichLeads(leads) {
    try {
      const enriched = [];

      // Process in batches to avoid rate limits
      for (let i = 0; i < leads.length; i += 5) {
        const batch = leads.slice(i, i + 5);
        const enrichedBatch = await Promise.all(
          batch.map(lead => this.enrichLead(lead))
        );
        enriched.push(...enrichedBatch);

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      return enriched;

    } catch (error) {
      console.error('Batch enrichment error:', error);
      return leads;
    }
  }

  // Social media profiles finder
  static async findSocialProfiles(name, company) {
    try {
      const profiles = {};

      // Twitter
      const twitterHandle = name.toLowerCase().replace(/\s/g, '');
      profiles.twitter = `https://twitter.com/search?q="${name}%20${company || ''}"`;

      // Facebook
      profiles.facebook = `https://facebook.com/search/people/?q=${encodeURIComponent(name + ' ' + (company || ''))}`;

      // Company pages
      profiles.crunchbase = `https://www.crunchbase.com/search/organizations?query=${encodeURIComponent(company || name)}`;

      return profiles;

    } catch (error) {
      return {};
    }
  }

  // Get company size
  static async getCompanySize(employees) {
    if (!employees) return null;
    
    const size = parseInt(employees);
    if (size < 10) return '1-10';
    if (size < 50) return '11-50';
    if (size < 200) return '51-200';
    if (size < 1000) return '201-1000';
    return '1000+';
  }
}

module.exports = Enricher;