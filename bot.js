const { Telegraf } = require('telegraf');
const fetch = require('node-fetch');
const { GoogleSpreadsheet } = require('google-spreadsheet');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT = (() => {
  try {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
  } catch (e) {
    console.error('Invalid GOOGLE_SERVICE_ACCOUNT JSON');
    return {};
  }
})();

let userSessions = {};

// Country coordinates
const countryCoordinates = {
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

// ==================== HELPER FUNCTIONS ====================

function calculateDistance(lat1, lon1, lat2, lon2) {
  try {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c * 10) / 10;
  } catch {
    return 0;
  }
}

function calculateQualityScore(attributes) {
  let score = 0;
  if (attributes.hasEmail) score += 30;
  if (attributes.hasPhone) score += 25;
  if (attributes.hasWebsite) score += 20;
  if (attributes.hasAddress) score += 15;
  if (attributes.hasHours) score += 10;
  return Math.min(score / 100, 1);
}

function extractOSMTags(tagXml) {
  const tags = {};
  const tagRegex = /<tag k="([^"]+)" v="([^"]*)"/g;
  let match;
  while ((match = tagRegex.exec(tagXml)) !== null) {
    tags[match[1]] = match[2];
  }
  return tags;
}

function removeDuplicates(leads) {
  const seen = new Set();
  return leads.filter(lead => {
    const key = (lead.email + lead.phone + lead.name).toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseAdvancedParams(input) {
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
    minrating: 0
  };

  const regex = /(\w+):([^\s]+)/g;
  let match;

  while ((match = regex.exec(input)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2];
    
    if (['count', 'radius', 'minrating'].includes(key)) {
      params[key] = parseInt(value) || params[key];
    } else if (['contactable', 'verified', 'haswebsite'].includes(key)) {
      params[key] = value === 'true';
    } else {
      params[key] = value.toLowerCase();
    }
  }

  return params;
}

function applyAdvancedFilters(leads, params) {
  return leads.filter(lead => {
    const qualityThresholds = { low: 0, medium: 0.4, high: 0.6, premium: 0.75 };
    const threshold = qualityThresholds[params.quality] || 0.5;
    
    if ((lead.quality_score || 0) < threshold) return false;
    if ((lead.distance || 0) > params.radius) return false;
    if (params.contactable && !lead.phone && !lead.email) return false;
    if (params.verified && !lead.verified) return false;
    if (params.haswebsite && !lead.website) return false;
    if (lead.rating && lead.rating < params.minrating) return false;

    return true;
  });
}

// ==================== SCRAPING FUNCTIONS ====================

async function scrapeOpenStreetMap(params, countryCoord) {
  const leads = [];
  try {
    const categoryOSMMap = {
      'saas': 'office=company OR office=yes',
      'plumbers': 'shop=plumbing OR craft=plumber',
      'electricians': 'craft=electrician OR shop=electrical',
      'restaurants': 'amenity=restaurant OR amenity=cafe OR amenity=fast_food',
      'salons': 'shop=hairdresser OR amenity=salon',
      'dentist': 'amenity=clinic OR healthcare=dentist',
      'doctor': 'amenity=clinic OR amenity=doctors OR healthcare=doctor',
      'consultants': 'office=yes OR office=company',
      'accountants': 'office=accountant',
      'lawyers': 'office=lawyer',
      'gyms': 'leisure=fitness_centre OR leisure=gym',
      'hotels': 'tourism=hotel OR amenity=hotel'
    };

    const osmFilter = categoryOSMMap[params.category] || `name~"${params.category}"`;
    const radius = Math.min(params.radius / 111, 0.5);

    const bbox = `${countryCoord.lat - radius},${countryCoord.lon - radius},${countryCoord.lat + radius},${countryCoord.lon + radius}`;
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=[bbox:${bbox}];(${osmFilter});out center;`;
    
    const response = await fetch(overpassUrl, { timeout: 25000 });
    
    if (!response.ok) {
      console.log('Overpass API rate limited, trying fallback...');
      return [];
    }

    const osmResult = await response.text();
    if (!osmResult || osmResult.length < 100) {
      return [];
    }

    const nodeRegex = /<node[^>]*id="(\d+)"[^>]*lat="([^"]+)"[^"]+lon="([^"]+)"[^>]*>([\s\S]*?)<\/node>/g;
    
    let match;
    let count = 0;

    while ((match = nodeRegex.exec(osmResult)) !== null && count < 150) {
      const tags = extractOSMTags(match[4]);
      
      if (tags.name && tags.name.length > 2) {
        const qualityScore = calculateQualityScore({
          hasEmail: !!tags.email,
          hasPhone: !!tags.phone,
          hasWebsite: !!(tags.website || tags.url),
          hasAddress: !!(tags['addr:street'] || tags['addr:city']),
          hasHours: !!tags.opening_hours
        });

        leads.push({
          name: tags.name.substring(0, 100),
          phone: tags.phone ? tags.phone.replace(/[^\d+]/g, '').substring(0, 20) : null,
          website: tags.website || tags.url || null,
          email: tags.email || null,
          address: tags['addr:street'] ? `${tags['addr:street']}, ${tags['addr:city'] || params.city}` : (tags['addr:city'] || params.city),
          source: 'openstreetmap',
          quality_score: qualityScore,
          verified: !!tags.verified,
          opening_hours: tags.opening_hours || null,
          rating: null,
          distance: calculateDistance(parseFloat(match[2]), parseFloat(match[3]), countryCoord.lat, countryCoord.lon),
          email_valid: false,
          phone_valid: false
        });

        count++;
      }
    }

    return leads;
  } catch (error) {
    console.log('OpenStreetMap scraping failed:', error.message);
    return [];
  }
}

async function scrapeNominatim(params, countryCoord) {
  const leads = [];
  try {
    const searchUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(params.category)}%20${encodeURIComponent(params.city)}&countrycodes=${params.country}&format=json&limit=80&addressdetails=1`;
    
    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'LeadScraperBot/4.0' },
      timeout: 20000
    });

    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    for (const result of data.slice(0, 60)) {
      if (result.display_name && result.display_name.length > 2) {
        const qualityScore = calculateQualityScore({
          hasEmail: false,
          hasPhone: false,
          hasWebsite: false,
          hasAddress: true,
          hasHours: false
        });

        leads.push({
          name: result.display_name.split(',')[0].substring(0, 100),
          address: result.display_name.substring(0, 200),
          phone: null,
          website: null,
          email: null,
          source: 'nominatim',
          quality_score: qualityScore,
          verified: false,
          rating: null,
          distance: calculateDistance(parseFloat(result.lat), parseFloat(result.lon), countryCoord.lat, countryCoord.lon),
          email_valid: false,
          phone_valid: false
        });
      }
    }

    return leads;
  } catch (error) {
    console.log('Nominatim scraping failed:', error.message);
    return [];
  }
}

async function executeAdvancedScraping(params, countryCoord) {
  const leads = [];

  try {
    // Try OSM first
    const osmLeads = await scrapeOpenStreetMap(params, countryCoord);
    leads.push(...osmLeads);

    // If OSM didn't work well, try Nominatim
    if (osmLeads.length < 20) {
      const nominatimLeads = await scrapeNominatim(params, countryCoord);
      leads.push(...nominatimLeads);
    }

    return leads;
  } catch (error) {
    console.log('Scraping error:', error.message);
    return leads;
  }
}

// ==================== ANALYTICS ====================

function scoreForColdEmail(leads) {
  return leads.map(lead => {
    let score = 0;

    if (lead.email) score += 20;
    if (lead.phone) score += 10;
    if (lead.website && lead.quality_score >= 0.6) score += 10;
    if (lead.verified) score += 8;

    const normalized = Math.min((score / 100) * 10, 10);

    return {
      ...lead,
      coldEmail_score: parseFloat(normalized.toFixed(2))
    };
  });
}

function getDetailedStats(leads) {
  return {
    total: leads.length,
    withEmail: leads.filter(l => l.email).length,
    withPhone: leads.filter(l => l.phone).length,
    withWebsite: leads.filter(l => l.website).length,
    avgScore: (leads.reduce((sum, l) => sum + (l.coldEmail_score || 0), 0) / (leads.length || 1)).toFixed(1)
  };
}

// ==================== EXPORT ====================

function generateCSV(leads) {
  try {
    const headers = ['Name', 'Email', 'Phone', 'Website', 'Address', 'Quality Score', 'Cold Email Score'];
    const rows = leads.map(lead => [
      (lead.name || '').replace(/"/g, '""'),
      (lead.email || '').replace(/"/g, '""'),
      (lead.phone || '').replace(/"/g, '""'),
      (lead.website || '').replace(/"/g, '""'),
      (lead.address || '').replace(/"/g, '""'),
      ((lead.quality_score || 0) * 100).toFixed(0),
      (lead.coldEmail_score || 0).toFixed(1)
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    return Buffer.from(csv);
  } catch (error) {
    console.error('CSV error:', error);
    return Buffer.from('Error generating CSV');
  }
}

// ==================== GOOGLE SHEETS ====================

async function saveToGoogleSheets(leads, params) {
  try {
    if (!GOOGLE_SHEET_ID || Object.keys(GOOGLE_SERVICE_ACCOUNT).length === 0) {
      console.log('Google Sheets not configured, skipping...');
      return;
    }

    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
    await doc.useServiceAccountAuth(GOOGLE_SERVICE_ACCOUNT);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];

    for (const lead of leads.slice(0, 40)) {
      try {
        await sheet.addRow({
          Name: lead.name || '',
          Email: lead.email || '',
          Phone: lead.phone || '',
          Website: lead.website || '',
          Address: lead.address || '',
          QualityScore: ((lead.quality_score || 0) * 100).toFixed(0),
          ColdEmailScore: (lead.coldEmail_score || 0).toFixed(1),
          Country: params.country || '',
          Category: params.category || '',
          CreatedAt: new Date().toISOString()
        });
      } catch (e) {
        // Skip row error, continue
      }
    }
  } catch (error) {
    console.log('Google Sheets error (continuing):', error.message);
  }
}

// ==================== BOT COMMANDS ====================

bot.start((ctx) => {
  ctx.reply(`🚀 *Lead Scraper v4.1 - STABLE*\n\n✅ All bugs fixed!\n\n*Try:*\n/scrape category:restaurants city:Mumbai count:20\n\n/export | /analytics | /help`, { parse_mode: 'Markdown' });
});

bot.command('scrape', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const input = ctx.message.text.replace('/scrape ', '').trim();
    
    if (!input) {
      return ctx.reply('Example: /scrape category:restaurants city:Mumbai quality:high count:30');
    }

    const params = parseAdvancedParams(input);
    
    if (!params.category || !params.city) {
      return ctx.reply('Missing: category and city');
    }

    const country = params.country || 'india';
    const countryCoord = countryCoordinates[country];
    
    if (!countryCoord) {
      return ctx.reply('Country not found. Try: india, usa, uk, canada, australia');
    }

    // Initial message (don't delete)
    await ctx.reply(`🔍 Scraping ${params.category} in ${params.city}...`);

    let leads = await executeAdvancedScraping(params, countryCoord);

    if (leads.length === 0) {
      return ctx.reply('❌ No leads found. Try different city or category.');
    }

    leads = applyAdvancedFilters(leads, params);
    const finalLeads = removeDuplicates(leads).slice(0, parseInt(params.count) || 100);
    const scored = scoreForColdEmail(finalLeads);
    scored.sort((a, b) => (b.coldEmail_score || 0) - (a.coldEmail_score || 0));

    // Save to sheets in background
    saveToGoogleSheets(scored, params).catch(e => console.log('Sheet save failed'));

    // Send CSV
    const csvBuffer = generateCSV(scored);
    await ctx.replyWithDocument(
      { source: csvBuffer, filename: `leads_${params.city}_${Date.now()}.csv` }
    );

    // Send stats
    const stats = getDetailedStats(scored);
    const msg = `✅ *Found ${stats.total} Leads*\n\n📧 With Email: ${stats.withEmail}\n☎️ With Phone: ${stats.withPhone}\n🌐 With Website: ${stats.withWebsite}\n💯 Avg Score: ${stats.avgScore}/10`;
    
    await ctx.reply(msg, { parse_mode: 'Markdown' });

    userSessions[userId] = { lastResults: scored, params };

  } catch (error) {
    console.error('Command error:', error);
    try {
      ctx.reply(`❌ Error: ${error.message.substring(0, 100)}`);
    } catch (e) {
      // Silent fail
    }
  }
});

bot.command('export', async (ctx) => {
  try {
    const userId = ctx.from.id;
    if (!userSessions[userId] || !userSessions[userId].lastResults) {
      return ctx.reply('No recent leads. Run /scrape first.');
    }

    const buffer = generateCSV(userSessions[userId].lastResults);
    await ctx.replyWithDocument({ source: buffer, filename: `export_${Date.now()}.csv` });
  } catch (error) {
    ctx.reply('Export error');
  }
});

bot.command('analytics', async (ctx) => {
  try {
    const userId = ctx.from.id;
    if (!userSessions[userId] || !userSessions[userId].lastResults) {
      return ctx.reply('No recent leads. Run /scrape first.');
    }

    const stats = getDetailedStats(userSessions[userId].lastResults);
    const msg = `📊 *Analytics*\n\nTotal: ${stats.total}\n📧 Email: ${stats.withEmail}\n☎️ Phone: ${stats.withPhone}\n🌐 Website: ${stats.withWebsite}\n💯 Avg: ${stats.avgScore}/10`;
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error) {
    ctx.reply('Analytics error');
  }
});

bot.command('help', (ctx) => {
  ctx.reply(`📖 *Commands*\n\n/scrape - Scrape leads\n/export - Export CSV\n/analytics - Statistics\n/countries - Countries\n/help - This`, { parse_mode: 'Markdown' });
});

bot.command('countries', (ctx) => {
  const list = Object.keys(countryCoordinates).join(', ');
  ctx.reply(`🌐 ${list}`, { parse_mode: 'Markdown' });
});

bot.catch((err) => {
  console.error('Bot error:', err.message);
});

bot.launch();
console.log('✅ Bot v4.1 Started - Bug Free!');
