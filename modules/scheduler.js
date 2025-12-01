// ==================== SCHEDULER MODULE ====================
const cron = require('node-cron');

class Scheduler {
  static jobs = {};

  // Create bulk job
  static createBulkJob(input, userId) {
    try {
      const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const config = this.parseScheduleInput(input);
      config.userId = userId;
      config.createdAt = new Date();
      config.nextRun = this.calculateNextRun(config.time);
      config.runs = 0;
      config.lastRun = null;

      this.jobs[jobId] = config;

      // Schedule the job
      if (config.frequency === 'daily') {
        this.scheduleDaily(jobId, config);
      } else if (config.frequency === 'weekly') {
        this.scheduleWeekly(jobId, config);
      } else if (config.frequency === 'monthly') {
        this.scheduleMonthly(jobId, config);
      }

      return jobId;
    } catch (error) {
      console.error('Job creation error:', error);
      throw error;
    }
  }

  static parseScheduleInput(input) {
    const config = {
      cities: [],
      categories: [],
      frequency: 'daily',
      time: '09:00',
      duration: 7,
      country: 'india',
      quality: 'high',
      count: 100
    };

    const regex = /(\w+):([^\s]+)/g;
    let match;

    while ((match = regex.exec(input)) !== null) {
      const key = match[1].toLowerCase();
      const value = match[2];

      if (key === 'cities' || key === 'categories') {
        config[key] = value.split(',');
      } else {
        config[key] = value;
      }
    }

    return config;
  }

  static calculateNextRun(time) {
    const [hours, minutes] = time.split(':').map(Number);
    const next = new Date();
    next.setHours(hours, minutes, 0);

    if (next < new Date()) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  }

  static scheduleDaily(jobId, config) {
    const [hours, minutes] = config.time.split(':');
    const cronExp = `${minutes} ${hours} * * *`;

    cron.schedule(cronExp, () => {
      this.executeJob(jobId, config);
    });
  }

  static scheduleWeekly(jobId, config) {
    const [hours, minutes] = config.time.split(':');
    const cronExp = `${minutes} ${hours} * * 1`; // Monday

    cron.schedule(cronExp, () => {
      this.executeJob(jobId, config);
    });
  }

  static scheduleMonthly(jobId, config) {
    const [hours, minutes] = config.time.split(':');
    const cronExp = `${minutes} ${hours} 1 * *`; // 1st of month

    cron.schedule(cronExp, () => {
      this.executeJob(jobId, config);
    });
  }

  static async executeJob(jobId, config) {
    try {
      console.log(`Executing scheduled job: ${jobId}`);

      config.runs++;
      config.lastRun = new Date();

      // Execute all city + category combinations
      for (const city of config.cities) {
        for (const category of config.categories) {
          // Would call main Scraper here
          console.log(`Scraping ${category} in ${city} for job ${jobId}`);
        }
      }

      // Check if job should continue
      const daysSinceCreation = (new Date() - config.createdAt) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation >= config.duration) {
        this.cancelJob(jobId);
      }

    } catch (error) {
      console.error(`Job execution error (${jobId}):`, error);
    }
  }

  static getJobConfig(jobId) {
    return this.jobs[jobId] || null;
  }

  static cancelJob(jobId) {
    delete this.jobs[jobId];
    console.log(`Job cancelled: ${jobId}`);
  }

  static getAllJobs() {
    return this.jobs;
  }
}

module.exports = { Competitor, Exporter, Scheduler };