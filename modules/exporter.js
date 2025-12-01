// ==================== EXPORTER MODULE ====================
const ExcelJS = require('exceljs');

class Exporter {
  // CSV Export for cold email
  static generateCSV(leads, template = 'cold-email') {
    try {
      const headers = [
        'Name', 'Email', 'Phone', 'Company', 'Job Title',
        'LinkedIn', 'Website', 'Quality Score', 'Cold Email Score',
        'Priority', 'Industry', 'Email Valid', 'Phone Valid'
      ];

      const rows = leads.map(lead => [
        lead.name || '',
        lead.email || '',
        lead.phone || '',
        lead.company || '',
        lead.jobTitle || '',
        lead.linkedin || '',
        lead.website || '',
        ((lead.quality_score || 0) * 100).toFixed(0) + '%',
        (lead.coldEmail_score || 0).toFixed(1),
        lead.outreachPriority || 'MEDIUM',
        lead.industry || '',
        lead.email_valid ? 'Yes' : 'No',
        lead.phone_valid ? 'Yes' : 'No'
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

  // JSON Export
  static generateJSON(leads) {
    return Buffer.from(JSON.stringify(leads, null, 2));
  }

  // Excel Export
  static async generateExcel(leads) {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Leads');

      // Headers
      const headers = [
        'Name', 'Email', 'Phone', 'Company', 'Job Title',
        'LinkedIn', 'Website', 'Quality Score', 'Cold Email Score',
        'Priority', 'Industry', 'Email Valid', 'Phone Valid'
      ];

      worksheet.columns = headers.map(h => ({ header: h, key: h.toLowerCase().replace(' ', '_') }));

      // Data rows
      leads.forEach(lead => {
        worksheet.addRow({
          name: lead.name || '',
          email: lead.email || '',
          phone: lead.phone || '',
          company: lead.company || '',
          job_title: lead.jobTitle || '',
          linkedin: lead.linkedin || '',
          website: lead.website || '',
          quality_score: ((lead.quality_score || 0) * 100).toFixed(0) + '%',
          cold_email_score: (lead.coldEmail_score || 0).toFixed(1),
          priority: lead.outreachPriority || 'MEDIUM',
          industry: lead.industry || '',
          email_valid: lead.email_valid ? 'Yes' : 'No',
          phone_valid: lead.phone_valid ? 'Yes' : 'No'
        });
      });

      // Formatting
      worksheet.columns.forEach(column => {
        column.width = 15;
      });

      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' } };

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return buffer;
    } catch (error) {
      console.error('Excel generation error:', error);
      return Buffer.from('');
    }
  }

  // Mailchimp CSV Format
  static generateMailchimp(leads) {
    try {
      const headers = ['Email Address', 'First Name', 'Last Name', 'Company', 'Phone Number'];
      
      const rows = leads.map(lead => {
        const nameParts = (lead.name || '').split(' ');
        return [
          lead.email || '',
          nameParts[0] || '',
          nameParts[1] || '',
          lead.company || '',
          lead.phone || ''
        ];
      });

      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      return Buffer.from(csv);
    } catch (error) {
      return Buffer.from('');
    }
  }

  // HubSpot CSV Format
  static generateHubSpot(leads) {
    try {
      const headers = ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle', 'website'];
      
      const rows = leads.map(lead => {
        const nameParts = (lead.name || '').split(' ');
        return [
          nameParts[0] || '',
          nameParts[1] || '',
          lead.email || '',
          lead.phone || '',
          lead.company || '',
          lead.jobTitle || '',
          lead.website || ''
        ];
      });

      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      return Buffer.from(csv);
    } catch (error) {
      return Buffer.from('');
    }
  }
}