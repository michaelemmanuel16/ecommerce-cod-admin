#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function convertHtmlToPdf() {
  const htmlPath = path.join(__dirname, '../docs/guides/CUSTOMER_REP_ONBOARDING.html');
  const pdfPath = path.join(__dirname, '../docs/guides/CUSTOMER_REP_ONBOARDING.pdf');

  console.log('Converting HTML to PDF...');
  console.log('Input:', htmlPath);
  console.log('Output:', pdfPath);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });

  await page.pdf({
    path: pdfPath,
    format: 'A4',
    margin: {
      top: '20mm',
      right: '20mm',
      bottom: '20mm',
      left: '20mm'
    },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size: 10px; text-align: center; width: 100%;"><span class="date"></span></div>',
    footerTemplate: '<div style="font-size: 10px; text-align: center; width: 100%;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
  });

  await browser.close();

  console.log('✅ PDF generated successfully!');
}

convertHtmlToPdf().catch(console.error);
