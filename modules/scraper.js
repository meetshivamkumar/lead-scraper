const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { GoogleSpreadsheet } = require('google-spreadsheet');

class Scraper {
  static COUNTRY_COORDINATES = {
    'india': { lat: 20.5937, lon: 78.9629 },
    'usa': { lat: 37.0902, lon: -95.7129 },
    'uk': { lat: 55.3781, lon: -3.4360 },
    'canada': { lat: 56.1304, lon: -106.3468 },
    'australia': { lat: -25.2744, lon: 133.7751 },
    'germany': { lat: 51.1657, lon: 10.4515 },
    'france': { lat: 46.2276, lon: 2.2137 },
    'uae': { lat: 23.4241, lon: 53.8478 },
    'singapore': { lat: 1.3521, lon: 103.8198 },
    'japan': { lat: 36.2048, lon: 138.2529 },
    'brazil': { lat: -14.2350, lon: -51.9253 },
    'mexico': { lat: 23.6345, lon: -102.5528 }
  };

  // Parse advanced input parameters
  static parseAdvancedParams(input) {
    const params = {
      category: 'business',
      city: 'Mumbai',
      country: 'india',
      quality: 'high',
      count: 100,
      radius: 15,
      contactable: false,
      verified: false,
      haswebsite: false,
      minrating: 0,
      sort: 'quality',
      order: 'desc',
      validate: false,
      enrich: false,
      coldready: false
    };

    const regex = /(\w+):([^\s]+)/g;
    let match;

    while ((match = regex.exec(input)) !== null) {
      const key = match[1].toLowerCase();
      const value = match[2];
      
      if (['count', 'radius', 'minrating'].includes(key)) {
        params[key] = parseInt(value);
      } else if (['contactable', 'verified', 'haswebsite', 'validate', 'enrich', 'coldready'].includes(key)) {
        params[key] = value === 'true';
      } else {
        params[key] = value;
      }
    }

    return params;
  }

  // Execute advanced scraping from multiple sources
  static async executeAdvancedScraping(params, countryCoord) {
    const leads = [];

    try {
      // Source 1: OpenStreetMap (Most reliable for international)
      const osmLeads = await this.scrapeOpenStreetMapAdvanced(params, countryCoord);
      leads.push(...osmLeads);

      // Source 2: Nominatim Geocoding
      const nominatimLeads = await this.scrapeNominatimAdvanced(params, countryCoord);
      leads.push(...nominatimLeads);

      // Source 3: Business directories (country-specific)
      const directoryLeads = await this.scrapeDirectoriesAdvanced(params, countryCoord);
      leads.push(...directoryLeads);

      return leads;
    } catch (error) {
      console.error('Scraping error:', error);
      return leads;
    }
  }

  // OpenStreetMap advanced scraping
  static async scrapeOpenStreetMapAdvanced(params, countryCoord) {
    const leads = [];
    try {
      const categoryOSMMap = {
        'saas-founders': 'office=company OR office=yes',
        'plumbers': 'shop=plumbing OR craft=plumber',
        'electricians': 'craft=electrician OR shop=electrical',
        'restaurants': 'amenity=restaurant OR amenity=cafe',
        'salons': 'shop=hairdresser OR amenity=salon',
        'dentist': 'amenity=clinic OR healthcare=dentist',
        'doctor': 'amenity=clinic OR amenity=doctors OR healthcare=doctor',
        'consultants': 'office=yes OR office=company',
        'accountants': 'office=accountant',
        'lawyers': 'office=lawyer',
        'gyms': 'leisure=fitness_centre OR leisure=gym',
        'hotels': 'tourism=hotel OR amenity=hotel'
      };

      const osmFilter = categoryOSMMap[params.category.toLowerCase()] || params.category;
      const radius = params.radius / 111; // Convert km to degrees

      const bbox = `${countryCoord.lat - radius},${countryCoord.lon - radius},${countryCoord.lat + radius},${countryCoord.lon + radius}`;
      const overpassUrl = `https://overpass-api.de/api/interpreter?data=[bbox:${bbox}];(${osmFilter});out center;`;
      
      const response = await fetch(overpassUrl, { timeout: 20000 });
      if (!response.ok) throw new Error('Overpass API error');

      const osmResult = await response.text();
      const nodeRegex = /<node[^>]*id="(\d+)"[^>]*lat="([^"]+)"[^"]+lon="([^"]+)"[^>]*>([\s\S]*?)<\/node>/g;
      
      let match;
      let count = 0;

      while ((match = nodeRegex.exec(osmResult)) !== null && count < 200) {
        const tags = this.extractOSMTags(match[4]);
        
        if (tags.name) {
          const qualityScore = this.calculateQualityScore({
            hasEmail: !!tags.email,
            hasPhone: !!tags.phone,
            hasWebsite: !!(tags.website || tags.url),
            hasAddress: !!(tags['addr:street'] || tags['addr:city']),
            hasHours: !!tags.opening_hours
          });

          leads.push({
            name: tags.name || 'Unknown',
            phone: tags.phone ? tags.phone.replace(/^[+]/, '') : null,
            website: tags.website || tags.url || null,
            email: tags.email || null,
            address: tags['addr:street'] ? `${tags['addr:street']}, ${tags['addr:city'] || params.city}` : params.city,
            source: 'openstreetmap',
            quality_score: qualityScore,
            osm_id: match[1],
            verified: !!tags.verified,
            opening_hours: tags.opening_hours || null,
            rating: null,
            distance: this.calculateDistance(parseFloat(match[2]), parseFloat(match[3]), countryCoord.lat, countryCoord.lon),
            description: tags.description || ''
          });

          count++;
        }
      }

      return leads;
    } catch (error) {
      console.error('OpenStreetMap error:', error);
      return [];
    }
  }

  // Nominatim advanced
  static async scrapeNominatimAdvanced(params, countryCoord) {
    const leads = [];
    try {
      const searchUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(params.category)}%20${encodeURIComponent(params.city)}&countrycodes=${params.country}&format=json&limit=100&addressdetails=1`;
      
      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': 'LeadScraperBot/4.0' },
        timeout: 15000
      });

      if (!response.ok) throw new Error('Nominatim error');

      const data = await response.json();

      for (const result of data.slice(0, 50)) {
        if (result.display_name) {
          const qualityScore = this.calculateQualityScore({
            hasEmail: false,
            hasPhone: false,
            hasWebsite: false,
            hasAddress: true,
            hasHours: false
          });

          leads.push({
            name: result.display_name.split(',')[0] || 'Unknown',
            address: result.display_name || null,
            phone: null,
            website: null,
            email: null,
            source: 'nominatim',
            quality_score: qualityScore,
            verified: false,
            rating: null,
            distance: this.calculateDistance(parseFloat(result.lat), parseFloat(result.lon), countryCoord.lat, countryCoord.lon)
          });
        }
      }

      return leads;
    } catch (error) {
      console.error('Nominatim error:', error);
      return [];
    }
  }

  // Directory scraping advanced
  static async scrapeDirectoriesAdvanced(params, countryCoord) {
    const leads = [];
    
    // Country-specific directories
    const directories = {
      'india': ['https://www.justdial.com/', 'https://www.sulekha.com/'],
      'usa': ['https://www.yelp.com/', 'https://www.yellowpages.com/'],
      'uk': ['https://www.yell.com/', 'https://www.theyellowyellowpages.com/'],
      'australia': ['https://www.whitepages.com.au/', 'https://www.business.com.au/']
    };

    const country = params.country?.toLowerCase() || 'india';
    const sources = directories[country] || [];

    for (const source of sources) {
      try {
        const searchUrl = `${source}${params.city.toLowerCase()}/${params.category.toLowerCase()}`;
        const response = await fetch(searchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 10000
        });

        if (response.ok) {
          const html = await response.text();
          const $ = cheerio.load(html);

          $('div.business-item, div.listing, div.result-item').each((i, el) => {
            const name = $(el).find('h2, .name, .title, a').first().text().trim();
            const phone = $(el).find('.phone, [data-phone]').text().trim();
            const website = $(el).find('a[href*="http"]').attr('href');
            const address = $(el).find('.address, .location').text().trim();

            if (name && (phone || address)) {
              leads.push({
                name: name || 'Unknown',
                phone: phone ? phone.replace(/\D/g, '').slice(-10) : null,
                website: website || null,
                email: null,
                address: address || null,
                source: 'directory',
                quality_score: 0.65,
                verified: false,
                rating: null,
                distance: 0
              });
            }
          });
        }
      } catch (error) {
        console.log(`Directory ${source} failed`);
      }
    }

    return leads;
  }

  // Apply advanced filters
  static applyAdvancedFilters(leads, params) {
    return leads.filter(lead => {
      // Quality filter
      const qualityThresholds = { low: 0, medium: 0.4, high: 0.6, premium: 0.75 };
      if ((lead.quality_score || 0) < (qualityThresholds[params.quality] || 0.5)) return false;

      // Radius filter
      if ((lead.distance || 0) > params.radius) return false;

      // Contactable filter (must have phone OR email)
      if (params.contactable && !lead.phone && !lead.email) return false;

      // Verified filter
      if (params.verified && !lead.verified) return false;

      // Has website filter
      if (params.haswebsite && !lead.website) return false;

      // Minimum rating filter
      if (lead.rating && lead.rating < params.minrating) return false;

      return true;
    });
  }

  // Remove duplicates
  static removeDuplicates(leads) {
    const seen = new Set();
    return leads.filter(lead => {
      const key = (lead.email + lead.phone + lead.name).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Calculate distance (Haversine formula)
  static calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c * 10) / 10;
  }

  // Calculate quality score
  static calculateQualityScore(attributes) {
    let score = 0;
    if (attributes.hasEmail) score += 30;
    if (attributes.hasPhone) score += 25;
    if (attributes.hasWebsite) score += 20;
    if (attributes.hasAddress) score += 15;
    if (attributes.hasHours) score += 10;
    return Math.min(score / 100, 1);
  }

  // Extract OSM tags
  static extractOSMTags(tagXml) {
    const tags = {};
    const tagRegex = /<tag k="([^"]+)" v="([^"]*)"/g;
    let match;
    while ((match = tagRegex.exec(tagXml)) !== null) {
      tags[match[1]] = match[2];
    }
    return tags;
  }

  // Save to Google Sheets
  static async saveToGoogleSheets(leads, params) {
    try {
      const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
      await doc.useServiceAccountAuth(JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}'));
      await doc.loadInfo();
      const sheet = doc.sheetsByIndex[0];

      for (const lead of leads.slice(0, 50)) { // Limit to 50 per batch
        await sheet.addRow({
          Name: lead.name || '',
          Email: lead.email || '',
          Phone: lead.phone || '',
          Website: lead.website || '',
          Address: lead.address || '',
          Company: lead.company || '',
          JobTitle: lead.jobTitle || '',
          LinkedIn: lead.linkedin || '',
          Source: lead.source || '',
          QualityScore: ((lead.quality_score || 0) * 100).toFixed(0),
          ColdEmailScore: (lead.coldEmail_score || 0).toFixed(1),
          Verified: lead.verified ? 'Yes' : 'No',
          Industry: lead.industry || '',
          Country: params.country || '',
          Category: params.category || '',
          CreatedAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Google Sheets error:', error);
    }
  }
}

module.exports = Scraper;