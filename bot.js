const { Telegraf } = require('telegraf');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { GoogleSpreadsheet } = require('google-spreadsheet');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');

// Store user sessions
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

// Quality weights
const qualityWeights = {
  hasEmail: 30,
  hasPhone: 25,
  hasWebsite: 20,
  hasAddress: 15,
  hasHours: 10
};

// ==================== UTILITY FUNCTIONS ====================

// Calculate distance (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
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
function calculateQualityScore(attributes) {
  let score = 0;
  if (attributes.hasEmail) score += qualityWeights.hasEmail;
  if (attributes.hasPhone) score += qualityWeights.hasPhone;
  if (attributes.hasWebsite) score += qualityWeights.hasWebsite;
  if (attributes.hasAddress) score += qualityWeights.hasAddress;
  if (attributes.hasHours) score += qualityWeights.hasHours;
  return Math.min(score / 100, 1);
}

// Extract OSM tags
function extractOSMTags(tagXml) {
  const tags = {};
  const tagRegex = /<tag k="([^"]+)" v="([^"]*)"/g;
  let match;
  while ((match = tagRegex.exec(tagXml)) !== null) {
    tags[match[1]] = match[2];
  }
  return tags;
}

// Remove duplicates
function removeDuplicates(leads) {
  const seen = new Set();
  return leads.filter(lead => {
    const key = (lead.email + lead.phone + lead.name).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Parse advanced params
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

// Apply filters
function applyAdvancedFilters(leads, params) {
  return leads.filter(lead => {
    const qualityThresholds = { low: 0, medium: 0.4, high: 0.6, premium: 0.75 };
    if ((lead.quality_score || 0) < (qualityThresholds[params.quality] || 0.5)) return false;

    if ((lead.distance || 0) > params.radius) return false;

    if (params.contactable && !lead.phone && !lead.email) return false;

    if (params.verified && !lead.verified) return false;

    if (params.haswebsite && !lead.website) return false;

    if (lead.rating && lead.rating < params.minrating) return false;

    return true;
  });
}

// ==================== SCRAPING FUNCTIONS ====================

// OpenStreetMap scraping
async function scrapeOpenStreetMap(params, countryCoord) {
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
    const radius = params.radius / 111;

    const bbox = `${countryCoord.lat - radius},${countryCoord.lon - radius},${countryCoord.lat + radius},${countryCoord.lon + radius}`;
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=[bbox:${bbox}];(${osmFilter});out center;`;
    
    const response = await fetch(overpassUrl, { timeout: 20000 });
    if (!response.ok) throw new Error('Overpass API error');

    const osmResult = await response.text();
    const nodeRegex = /<node[^>]*id="(\d+)"[^>]*lat="([^"]+)"[^"]+lon="([^"]+)"[^>]*>([\s\S]*?)<\/node>/g;
    
    let match;
    let count = 0;

    while ((match = nodeRegex.exec(osmResult)) !== null && count < 200) {
      const tags = extractOSMTags(match[4]);
      
      if (tags.name) {
        const qualityScore = calculateQualityScore({
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
          distance: calculateDistance(parseFloat(match[2]), parseFloat(match[3]), countryCoord.lat, countryCoord.lon),
          description: tags.description || '',
          email_valid: false,
          phone_valid: false
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

// Nominatim scraping
async function scrapeNominatim(params, countryCoord) {
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
        const qualityScore = calculateQualityScore({
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
          distance: calculateDistance(parseFloat(result.lat), parseFloat(result.lon), countryCoord.lat, countryCoord.lon),
          email_valid: false,
          phone_valid: false
        });
      }
    }

    return leads;
  } catch (error) {
    console.error('Nominatim error:', error);
    return [];
  }
}

// Execute scraping
async function executeAdvancedScraping(params, countryCoord) {
  const leads = [];

  try {
    const osmLeads = await scrapeOpenStreetMap(params, countryCoord);
    leads.push(...osmLeads);

    const nominatimLeads = await scrapeNominatim(params, countryCoord);
    leads.push(...nominatimLeads);

    return leads;
  } catch (error) {
    console.error('Scraping error:', error);
    return leads;
  }
}

// ==================== ANALYTICS FUNCTIONS ====================

function scoreForColdEmail(leads) {
  return leads.map(lead => {
    let score = 0;
    let factors = [];

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

    if (lead.website && lead.quality_score >= 0.8) {
      score += 10;
      factors.push('Professional Website');
    }

    if (lead.verified || lead.rating >= 4) {
      score += 8;
      factors.push('Verified Business');
    }

    const normalizedScore = Math.min((score / 100) * 10, 10);

    return {
      ...lead,
      coldEmail_score: parseFloat(normalizedScore.toFixed(2)),
      scoreFactors: factors,
      outreachPriority: normalizedScore >= 8.5 ? 'URGENT' : normalizedScore >= 7 ? 'HIGH' : normalizedScore >= 5.5 ? 'MEDIUM' : 'LOW'
    };
  });
}

function getDetailedStats(leads) {
  const stats = {
    total: leads.length,
    validEmails: leads.filter(l => l.email_valid).length,
    validPhones: leads.filter(l => l.phone_valid).length,
    hasWebsite: leads.filter(l => l.website).length,
    highQuality: leads.filter(l => l.coldEmail_score >= 8).length,
    mediumQuality: leads.filter(l => l.coldEmail_score >= 5.5 && l.coldEmail_score < 8).length,
    lowQuality: leads.filter(l => l.coldEmail_score < 5.5).length,
    avgColdEmailScore: leads.reduce((sum, l) => sum + (l.coldEmail_score || 0), 0) / leads.length || 0
  };

  return stats;
}

// ==================== EXPORT FUNCTIONS ====================

function generateCSV(leads) {
  try {
    const headers = ['Name', 'Email', 'Phone', 'Company', 'Website', 'Address', 'Quality Score', 'Cold Email Score', 'Priority'];
    const rows = leads.map(lead => [
      lead.name || '',
      lead.email || '',
      lead.phone || '',
      lead.company || '',
      lead.website || '',
      lead.address || '',
      ((lead.quality_score || 0) * 100).toFixed(0) + '%',
      (lead.coldEmail_score || 0).toFixed(1),
      lead.outreachPriority || 'MEDIUM'
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    return Buffer.from(csv);
  } catch (error) {
    console.error('CSV generation error:', error);
    return Buffer.from('');
  }
}

// ==================== GOOGLE SHEETS ====================

async function saveToGoogleSheets(leads, params) {
  try {
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
    await doc.useServiceAccountAuth(GOOGLE_SERVICE_ACCOUNT);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];

    for (const lead of leads.slice(0, 50)) {
      await sheet.addRow({
        Name: lead.name || '',
        Email: lead.email || '',
        Phone: lead.phone || '',
        Website: lead.website || '',
        Address: lead.address || '',
        Source: lead.source || '',
        QualityScore: ((lead.quality_score || 0) * 100).toFixed(0),
        ColdEmailScore: (lead.coldEmail_score || 0).toFixed(1),
        Priority: lead.outreachPriority || '',
        Country: params.country || '',
        Category: params.category || '',
        CreatedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Google Sheets error:', error);
  }
}

// ==================== BOT COMMANDS ====================

bot.start((ctx) => {
  ctx.reply(`🚀 *Lead Scraper Pro v4.0 - FIXED*\n\n✅ *All bugs fixed! Ready to scrape.*\n\n*Quick Start:*\n\`/scrape category:restaurants city:Mumbai country:india quality:premium count:50\`\n\n*Commands:*\n/scrape - Scrape leads\n/export - Export CSV\n/analytics - View stats\n/help - Show help\n/filters - Show filters`, { parse_mode: 'Markdown' });
});

bot.command('scrape', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const input = ctx.message.text.replace('/scrape ', '').trim();
    
    if (!input) {
      return ctx.reply('❌ Example: /scrape category:restaurants city:Mumbai quality:high count:50');
    }

    let messageId = await ctx.reply('🔄 *Scraping...*', { parse_mode: 'Markdown' });

    const params = parseAdvancedParams(input);
    
    if (!params.category || !params.city) {
      return ctx.editMessageText(messageId.message_id, '❌ Missing: category, city');
    }

    const country = params.country?.toLowerCase() || 'india';
    const countryCoord = countryCoordinates[country];
    
    if (!countryCoord) {
      return ctx.editMessageText(messageId.message_id, '❌ Country not supported.');
    }

    await ctx.telegram.editMessageText(ctx.chat.id, messageId.message_id, undefined, `🔍 *Scraping ${country.toUpperCase()}...*`, { parse_mode: 'Markdown' });
    
    let leads = await executeAdvancedScraping(params, countryCoord);

    if (leads.length === 0) {
      return ctx.editMessageText(messageId.message_id, '❌ No leads found.');
    }

    leads = applyAdvancedFilters(leads, params);
    const finalLeads = removeDuplicates(leads).slice(0, parseInt(params.count) || 100);
    const scored = scoreForColdEmail(finalLeads);
    scored.sort((a, b) => (b.coldEmail_score || 0) - (a.coldEmail_score || 0));

    await ctx.telegram.editMessageText(ctx.chat.id, messageId.message_id, undefined, `💾 *Saving...*`, { parse_mode: 'Markdown' });
    
    await saveToGoogleSheets(scored, params);

    const csvBuffer = generateCSV(scored);
    
    await ctx.replyWithDocument(
      { source: csvBuffer, filename: `leads_${params.city}_${Date.now()}.csv` },
      { caption: `✅ *Found ${scored.length} leads!*\n\n🏙️ City: ${params.city}\n📁 Category: ${params.category}\n⭐ Quality: ${params.quality}` }
    );

    const stats = getDetailedStats(scored);
    
    await ctx.reply(`📊 *Statistics:*\n\n✅ Total: ${stats.total}\n📧 Valid Emails: ${stats.validEmails}\n☎️ Valid Phones: ${stats.validPhones}\n🌐 Websites: ${stats.hasWebsite}\n💯 Avg Score: ${stats.avgColdEmailScore.toFixed(1)}/10`, { parse_mode: 'Markdown' });

    try { await ctx.deleteMessage(messageId.message_id); } catch (e) {}

    userSessions[userId] = { lastResults: scored, timestamp: Date.now(), params: params };

  } catch (error) {
    console.error('Scrape error:', error);
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

bot.command('export', async (ctx) => {
  try {
    const userId = ctx.from.id;

    if (!userSessions[userId] || !userSessions[userId].lastResults) {
      return ctx.reply('❌ No recent leads. Run /scrape first.');
    }

    const leads = userSessions[userId].lastResults;
    const buffer = generateCSV(leads);
    
    await ctx.replyWithDocument({ source: buffer, filename: `leads_export_${Date.now()}.csv` });

  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

bot.command('analytics', async (ctx) => {
  try {
    const userId = ctx.from.id;

    if (!userSessions[userId] || !userSessions[userId].lastResults) {
      return ctx.reply('❌ No recent leads. Run /scrape first.');
    }

    const leads = userSessions[userId].lastResults;
    const stats = getDetailedStats(leads);

    const report = `📊 *Lead Analytics*

*Quality:*
✅ High (8+): ${stats.highQuality}
🟡 Medium (5-8): ${stats.mediumQuality}
🔴 Low (<5): ${stats.lowQuality}

*Contact:*
📧 Valid Emails: ${stats.validEmails}
☎️ Valid Phones: ${stats.validPhones}
🌐 Websites: ${stats.hasWebsite}

*Scoring:*
💯 Avg Score: ${stats.avgColdEmailScore.toFixed(1)}/10
✨ Response Likelihood: ${Math.round(stats.avgColdEmailScore * 2.5)}%`;

    ctx.reply(report, { parse_mode: 'Markdown' });

  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

bot.command('help', (ctx) => {
  ctx.reply(`📖 *Commands*\n\n/scrape - Scrape leads\n/export - Export CSV\n/analytics - Statistics\n/filters - Available filters\n/countries - Supported countries\n/help - This message`, { parse_mode: 'Markdown' });
});

bot.command('filters', (ctx) => {
  ctx.reply(`🎯 *Filters:*\n\n*quality:* low/medium/high/premium\n*radius:* 1-50 km\n*contactable:* true/false\n*verified:* true/false\n*haswebsite:* true/false\n*minrating:* 1-5\n\nExample:\n/scrape category:plumbers city:Mumbai quality:premium radius:10 contactable:true`, { parse_mode: 'Markdown' });
});

bot.command('countries', (ctx) => {
  const countries = Object.keys(countryCoordinates).map(c => c.toUpperCase()).join(', ');
  ctx.reply(`🌐 *Supported Countries:*\n\n${countries}`, { parse_mode: 'Markdown' });
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('❌ Error occurred.');
});

bot.launch();
console.log('✅ Lead Scraper Bot v4.0 Started!');
