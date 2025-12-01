const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Import modules
const Scraper = require('./modules/scraper');
const Validator = require('./modules/validator');
const Enricher = require('./modules/enricher');
const Analytics = require('./modules/analytics');
const Competitor = require('./modules/competitor');
const Exporter = require('./modules/exporter');
const Scheduler = require('./modules/scheduler');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Store user sessions
let userSessions = {};
let activeJobs = {};

// Country data
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

// ==================== START COMMAND ====================
bot.start((ctx) => {
  ctx.reply(`🚀 *Lead Scraper Pro v4.0 - COLD EMAIL READY*\n\n💼 *Your AI Cold Email Assistant*\n\n🎯 *Quick Start:*\n\`/scrape category:saas-founders city:SanFrancisco country:usa quality:premium count:50 validate:true enrich:true coldready:true\`\n\n*Key Features:*\n✅ High-quality leads for cold email\n✅ Email/Phone validation (real-time)\n✅ LinkedIn profile enrichment\n✅ Competitor lead finder\n✅ Lead scoring (purchase intent)\n✅ Bulk scheduling\n✅ Multi-format export\n✅ Cold email templates\n\n*Commands:*\n/scrape - Start scraping\n/bulk - Bulk schedule scraping\n/validate - Validate leads\n/enrich - Enrich with LinkedIn\n/competitors - Find competitor customers\n/score - AI lead scoring\n/export - Export leads\n/analytics - View statistics\n/cold - Cold email prep\n/help - Show help`, { parse_mode: 'Markdown' });
});

// ==================== MAIN SCRAPE COMMAND ====================
bot.command('scrape', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const input = ctx.message.text.replace('/scrape ', '').trim();
    
    if (!input) {
      return ctx.reply('❌ Example: /scrape category:saas-founders city:SanFrancisco country:usa quality:premium count:50 validate:true enrich:true coldready:true');
    }

    let messageId = await ctx.reply('🔄 *Scraping Advanced Setup...*\n⏳ Parsing parameters', { parse_mode: 'Markdown' });

    // Parse params
    const params = Scraper.parseAdvancedParams(input);
    
    if (!params.category || !params.city) {
      return ctx.editMessageText(messageId.message_id, '❌ Missing: category, city');
    }

    const country = params.country?.toLowerCase() || 'india';
    const countryCoord = countryCoordinates[country];
    
    if (!countryCoord) {
      return ctx.editMessageText(messageId.message_id, '❌ Country not supported. /countries to see list.');
    }

    // Step 1: Scrape
    await ctx.telegram.editMessageText(ctx.chat.id, messageId.message_id, undefined, `🔍 *Step 1/6: Scraping*\n⏳ Fetching leads from ${country}...`, { parse_mode: 'Markdown' });
    
    let leads = await Scraper.executeAdvancedScraping(params, countryCoord);
    
    if (leads.length === 0) {
      return ctx.editMessageText(messageId.message_id, '❌ No leads found.');
    }

    // Step 2: Apply filters
    await ctx.telegram.editMessageText(ctx.chat.id, messageId.message_id, undefined, `✅ Found ${leads.length} leads\n⏳ Step 2/6: Applying filters...`, { parse_mode: 'Markdown' });
    
    leads = Scraper.applyAdvancedFilters(leads, params);
    
    // Step 3: Validate (if requested)
    if (params.validate) {
      await ctx.telegram.editMessageText(ctx.chat.id, messageId.message_id, undefined, `✅ ${leads.length} leads after filtering\n⏳ Step 3/6: Validating emails/phones...`, { parse_mode: 'Markdown' });
      
      leads = await Validator.validateLeads(leads);
    }

    // Step 4: Enrich (if requested)
    if (params.enrich) {
      await ctx.telegram.editMessageText(ctx.chat.id, messageId.message_id, undefined, `✅ Validation complete\n⏳ Step 4/6: Enriching with LinkedIn/Company data...`, { parse_mode: 'Markdown' });
      
      leads = await Enricher.enrichLeads(leads);
    }

    // Step 5: Score leads (for cold email)
    if (params.coldready) {
      await ctx.telegram.editMessageText(ctx.chat.id, messageId.message_id, undefined, `✅ Enrichment complete\n⏳ Step 5/6: AI scoring for cold email...`, { parse_mode: 'Markdown' });
      
      leads = await Analytics.scoreForColdEmail(leads, params);
    }

    // Step 6: Remove duplicates
    leads = Scraper.removeDuplicates(leads);
    const finalLeads = leads.slice(0, parseInt(params.count) || 100);

    // Sort by score
    finalLeads.sort((a, b) => (b.coldEmail_score || 0) - (a.coldEmail_score || 0));

    await ctx.telegram.editMessageText(ctx.chat.id, messageId.message_id, undefined, `✅ Processing complete\n⏳ Step 6/6: Saving & exporting...`, { parse_mode: 'Markdown' });

    // Save to Google Sheets
    await Scraper.saveToGoogleSheets(finalLeads, params);

    // Generate exports
    const csvBuffer = Exporter.generateCSV(finalLeads, 'cold-email');
    const jsonBuffer = Buffer.from(JSON.stringify(finalLeads, null, 2));
    const excelbuffer = await Exporter.generateExcel(finalLeads);

    // Send CSV
    await ctx.replyWithDocument(
      { source: csvBuffer, filename: `leads_${params.city}_${Date.now()}.csv` },
      { caption: `✅ *Scraping Complete!*\n\n📊 Total Leads: ${finalLeads.length}\n🌍 Country: ${country.toUpperCase()}\n📁 Category: ${params.category}\n⭐ Quality: ${params.quality}\n\n📧 Validated: ${params.validate ? 'Yes' : 'No'}\n🔗 Enriched: ${params.enrich ? 'Yes' : 'No'}\n💯 Cold Email Score: ${params.coldready ? 'Yes' : 'No'}` }
    );

    // Send JSON
    await ctx.replyWithDocument(
      { source: jsonBuffer, filename: `leads_${params.city}_${Date.now()}.json` },
      { caption: '📋 JSON Export (for API integration)' }
    );

    // Get statistics
    const stats = Analytics.getDetailedStats(finalLeads);
    
    await ctx.reply(`📈 *Lead Statistics for Cold Email:*\n\n✅ Total: ${finalLeads.length}\n📧 Valid Emails: ${stats.validEmails} (${(stats.validEmails/finalLeads.length*100).toFixed(0)}%)\n☎️ Valid Phones: ${stats.validPhones} (${(stats.validPhones/finalLeads.length*100).toFixed(0)}%)\n🔗 LinkedIn Profiles: ${stats.hasLinkedIn} (${(stats.hasLinkedIn/finalLeads.length*100).toFixed(0)}%)\n💼 Company Info: ${stats.hasCompany} (${(stats.hasCompany/finalLeads.length*100).toFixed(0)}%)\n\n🎯 *Cold Email Readiness:*\n💯 Avg Score: ${stats.avgColdEmailScore.toFixed(1)}/10\n🟢 High Quality (8+): ${stats.highQuality}\n🟡 Medium Quality (5-8): ${stats.mediumQuality}\n🔴 Low Quality (<5): ${stats.lowQuality}`, { parse_mode: 'Markdown' });

    // Send preview
    const preview = finalLeads.slice(0, 3).map((lead, i) => 
      `${i+1}. *${lead.name}* (${lead.jobTitle || 'N/A'})\n📧 ${lead.email ? '✅' : '❌'} ${lead.email || 'N/A'}\n☎️ ${lead.phone || 'N/A'}\n🏢 ${lead.company || 'N/A'}\n💼 ${lead.linkedin || 'N/A'}\n💯 Score: ${(lead.coldEmail_score || 0).toFixed(1)}/10`
    ).join('\n\n');

    await ctx.reply(`📋 *Top 3 Leads (Cold Email Ready):*\n\n${preview}`, { parse_mode: 'Markdown' });

    // Delete processing message
    try { await ctx.deleteMessage(messageId.message_id); } catch (e) {}

    userSessions[userId] = { lastResults: finalLeads, timestamp: Date.now(), params: params };

  } catch (error) {
    console.error('Scrape error:', error);
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ==================== BULK SCHEDULING ====================
bot.command('bulk', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const input = ctx.message.text.replace('/bulk ', '').trim();

    if (!input) {
      return ctx.reply(`*Bulk Scheduling*\n\nExample:\n\`/bulk cities:Mumbai,Delhi,Bangalore categories:plumbers,electricians frequency:daily time:09:00 duration:7\`\n\nParameters:\n• cities: Comma-separated cities\n• categories: Comma-separated categories\n• frequency: daily/weekly/monthly\n• time: HH:MM (24-hour format)\n• duration: Days to repeat\n• country: Country code\n• quality: Quality level`, { parse_mode: 'Markdown' });
    }

    const jobId = await Scheduler.createBulkJob(input, userId);
    const jobConfig = Scheduler.getJobConfig(jobId);

    ctx.reply(`✅ *Bulk Job Scheduled*\n\n📋 Job ID: ${jobId}\n🏙️ Cities: ${jobConfig.cities.join(', ')}\n📁 Categories: ${jobConfig.categories.join(', ')}\n⏰ Frequency: ${jobConfig.frequency} at ${jobConfig.time}\n📅 Duration: ${jobConfig.duration} days\n\n📊 Estimated: ${jobConfig.cities.length * jobConfig.categories.length} searches\n\nUse /jobs to see active jobs`, { parse_mode: 'Markdown' });

    activeJobs[jobId] = jobConfig;

  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ==================== VALIDATION COMMAND ====================
bot.command('validate', async (ctx) => {
  try {
    const userId = ctx.from.id;
    
    if (!userSessions[userId] || !userSessions[userId].lastResults) {
      return ctx.reply('❌ No recent leads. Run /scrape first.');
    }

    let messageId = await ctx.reply('🔄 *Validating leads...*', { parse_mode: 'Markdown' });

    const leads = userSessions[userId].lastResults;
    const validated = await Validator.validateLeads(leads);

    const stats = {
      validEmails: validated.filter(l => l.email_valid).length,
      validPhones: validated.filter(l => l.phone_valid).length,
      totalValid: validated.filter(l => l.email_valid || l.phone_valid).length
    };

    await ctx.editMessageText(messageId.message_id, `✅ *Validation Complete*\n\n📧 Valid Emails: ${stats.validEmails}/${validated.length}\n☎️ Valid Phones: ${stats.validPhones}/${validated.length}\n✔️ Total Valid: ${stats.totalValid}/${validated.length}\n\n${stats.totalValid === validated.length ? '🟢 All leads valid!' : '⚠️ ' + (validated.length - stats.totalValid) + ' leads invalid'}`, { parse_mode: 'Markdown' });

    userSessions[userId].lastResults = validated;

  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ==================== ENRICHMENT COMMAND ====================
bot.command('enrich', async (ctx) => {
  try {
    const userId = ctx.from.id;
    
    if (!userSessions[userId] || !userSessions[userId].lastResults) {
      return ctx.reply('❌ No recent leads. Run /scrape first.');
    }

    let messageId = await ctx.reply('🔄 *Enriching leads with LinkedIn & company data...*', { parse_mode: 'Markdown' });

    const leads = userSessions[userId].lastResults;
    const enriched = await Enricher.enrichLeads(leads);

    const stats = {
      hasLinkedIn: enriched.filter(l => l.linkedin).length,
      hasCompany: enriched.filter(l => l.company).length,
      hasJobTitle: enriched.filter(l => l.jobTitle).length
    };

    await ctx.editMessageText(messageId.message_id, `✅ *Enrichment Complete*\n\n🔗 LinkedIn Profiles: ${stats.hasLinkedIn}/${enriched.length}\n🏢 Company Info: ${stats.hasCompany}/${enriched.length}\n💼 Job Titles: ${stats.hasJobTitle}/${enriched.length}`, { parse_mode: 'Markdown' });

    userSessions[userId].lastResults = enriched;

  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ==================== COMPETITOR ANALYSIS ====================
bot.command('competitors', async (ctx) => {
  try {
    const input = ctx.message.text.replace('/competitors ', '').trim();

    if (!input) {
      return ctx.reply('*Find Competitor Customers*\n\nExample:\n/competitors company:Shopify country:usa\n\nThis finds leads who mention competitor in their LinkedIn, websites, reviews, etc.', { parse_mode: 'Markdown' });
    }

    let messageId = await ctx.reply('🔍 *Analyzing competitor ecosystem...*', { parse_mode: 'Markdown' });

    const competitorLeads = await Competitor.findCompetitorCustomers(input);

    const stats = {
      total: competitorLeads.length,
      satisfied: competitorLeads.filter(l => l.satisfaction === 'high').length,
      unsatisfied: competitorLeads.filter(l => l.satisfaction === 'low').length
    };

    await ctx.editMessageText(messageId.message_id, `✅ *Found ${stats.total} Leads*\n\n😊 Satisfied Customers: ${stats.satisfied}\n😞 Unsatisfied/Churned: ${stats.unsatisfied}\n\n💡 *Insight:* Target unsatisfied competitors' customers!`, { parse_mode: 'Markdown' });

    userSessions[ctx.from.id].competitorLeads = competitorLeads;

  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ==================== COLD EMAIL SCORING ====================
bot.command('score', async (ctx) => {
  try {
    const userId = ctx.from.id;
    
    if (!userSessions[userId] || !userSessions[userId].lastResults) {
      return ctx.reply('❌ No recent leads. Run /scrape first.');
    }

    let messageId = await ctx.reply('🤖 *AI Scoring leads for cold email...*', { parse_mode: 'Markdown' });

    const leads = userSessions[userId].lastResults;
    const params = userSessions[userId].params || {};
    
    const scored = await Analytics.scoreForColdEmail(leads, params);
    scored.sort((a, b) => (b.coldEmail_score || 0) - (a.coldEmail_score || 0));

    const topLeads = scored.slice(0, 5).map((l, i) => 
      `${i+1}. ${l.name} - ${l.jobTitle || 'N/A'}\n   💯 Score: ${l.coldEmail_score.toFixed(1)}/10\n   📊 Factors: ${l.scoreFactors.join(', ')}`
    ).join('\n\n');

    await ctx.editMessageText(messageId.message_id, `✅ *Cold Email Scoring Done*\n\n🏆 *Top 5 Prospects:*\n${topLeads}\n\n💡 *Tip:* Focus on leads with 8+ score for best conversion!`, { parse_mode: 'Markdown' });

    userSessions[userId].lastResults = scored;

  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ==================== EXPORT COMMAND ====================
bot.command('export', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const format = ctx.message.text.replace('/export ', '').trim() || 'csv';

    if (!userSessions[userId] || !userSessions[userId].lastResults) {
      return ctx.reply('❌ No recent leads. Run /scrape first.');
    }

    const leads = userSessions[userId].lastResults;

    if (format === 'csv' || format === '') {
      const buffer = Exporter.generateCSV(leads, 'cold-email');
      await ctx.replyWithDocument({ source: buffer, filename: `leads_export_${Date.now()}.csv` });
    } else if (format === 'json') {
      const buffer = Buffer.from(JSON.stringify(leads, null, 2));
      await ctx.replyWithDocument({ source: buffer, filename: `leads_export_${Date.now()}.json` });
    } else if (format === 'excel') {
      const buffer = await Exporter.generateExcel(leads);
      await ctx.replyWithDocument({ source: buffer, filename: `leads_export_${Date.now()}.xlsx` });
    } else if (format === 'mailchimp') {
      const buffer = Exporter.generateMailchimp(leads);
      await ctx.replyWithDocument({ source: buffer, filename: `leads_mailchimp_${Date.now()}.csv` });
    }

  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ==================== ANALYTICS ====================
bot.command('analytics', async (ctx) => {
  try {
    const userId = ctx.from.id;

    if (!userSessions[userId] || !userSessions[userId].lastResults) {
      return ctx.reply('❌ No recent leads. Run /scrape first.');
    }

    const leads = userSessions[userId].lastResults;
    const stats = Analytics.getDetailedStats(leads);

    const report = `📊 *Lead Analytics Report*

*Quality Metrics:*
✅ High Quality (8+): ${stats.highQuality}
🟡 Medium (5-8): ${stats.mediumQuality}
🔴 Low (<5): ${stats.lowQuality}

*Contact Availability:*
📧 Valid Emails: ${stats.validEmails}
☎️ Valid Phones: ${stats.validPhones}

*Enrichment:*
🔗 LinkedIn: ${stats.hasLinkedIn}
🏢 Company: ${stats.hasCompany}
💼 Job Title: ${stats.hasJobTitle}

*Cold Email Readiness:*
💯 Average Score: ${stats.avgColdEmailScore.toFixed(1)}/10
✨ Response Likelihood: ${stats.responseLikelihood}%
💰 Estimated Value: $${stats.estimatedValue}

*Industry Distribution:*
${Object.entries(stats.byIndustry).map(([ind, count]) => `${ind}: ${count}`).join('\n')}

*Top Job Titles:*
${stats.topJobTitles.slice(0, 5).map((jt, i) => `${i+1}. ${jt}`).join('\n')}`;

    ctx.reply(report, { parse_mode: 'Markdown' });

  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ==================== COLD EMAIL PREP ====================
bot.command('cold', async (ctx) => {
  try {
    const userId = ctx.from.id;

    if (!userSessions[userId] || !userSessions[userId].lastResults) {
      return ctx.reply('❌ No recent leads. Run /scrape first.');
    }

    const leads = userSessions[userId].lastResults.slice(0, 10);
    const templates = Analytics.generateColdEmailTemplates(leads);

    let msg = '✉️ *Cold Email Templates Generated*\n\n';
    
    templates.forEach((template, i) => {
      msg += `*Template ${i+1}* (${template.leadName})\n\n${template.subject}\n\n${template.body}\n\n---\n\n`;
    });

    // Split message if too long
    if (msg.length > 4000) {
      const chunks = msg.match(/[\s\S]{1,4000}/g);
      chunks.forEach(chunk => ctx.reply(chunk, { parse_mode: 'Markdown' }));
    } else {
      ctx.reply(msg, { parse_mode: 'Markdown' });
    }

  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ==================== HELP ====================
bot.command('help', (ctx) => {
  ctx.reply(`📖 *Lead Scraper Pro v4.0 - Commands*

*Core:*
/scrape - Main scraping command
/bulk - Schedule bulk jobs
/export - Export leads (csv/json/excel)

*Enhancement:*
/validate - Validate emails/phones
/enrich - Get LinkedIn & company data
/score - AI cold email scoring

*Analysis:*
/competitors - Find competitor customers
/analytics - View lead statistics
/cold - Generate cold email templates

*Management:*
/jobs - Active scheduled jobs
/cancel - Cancel job
/settings - Bot settings

*Help:*
/help - Show this message
/filters - Available filters
/countries - Supported countries`, { parse_mode: 'Markdown' });
});

// ==================== ADDITIONAL COMMANDS ====================
bot.command('jobs', (ctx) => {
  const jobs = Object.entries(activeJobs).map(([id, config]) => 
    `📋 ${id}\n   Cities: ${config.cities.join(', ')}\n   Next: ${config.nextRun}`
  ).join('\n\n');

  ctx.reply(jobs || '❌ No active jobs', { parse_mode: 'Markdown' });
});

bot.command('countries', (ctx) => {
  const countries = Object.keys(countryCoordinates).map(c => c.toUpperCase()).join(', ');
  ctx.reply(`🌐 *Supported Countries:*\n\n${countries}`, { parse_mode: 'Markdown' });
});

bot.command('filters', (ctx) => {
  ctx.reply(`🎯 *Available Filters:*

*Quality:* low/medium/high/premium
*Radius:* 1-50 km
*Contactable:* true/false
*Verified:* true/false
*HasWebsite:* true/false
*MinRating:* 1-5
*ColdReady:* true/false
*Sort:* quality/rating/distance/score
*Order:* asc/desc

*Cold Email Specific:*
/validate - Check if emails/phones work
/enrich - Get LinkedIn profiles
/score - AI scoring for cold outreach
/cold - Generate email templates`, { parse_mode: 'Markdown' });
});

// Error handling
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('❌ Something went wrong. Try again.');
});

// Launch
bot.launch();
console.log('🚀 Lead Scraper Pro v4.0 Started!');