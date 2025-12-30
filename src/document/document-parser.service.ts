import { Injectable } from '@nestjs/common';
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import * as officeParser from 'officeparser';
import * as cheerio from 'cheerio';

@Injectable()
export class DocumentParserService {
  // Normalize text - remove excessive whitespace, normalize newlines
  private normalizeText(text: string): string {
    return text
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  async parsePdf(buffer: Buffer): Promise<string> {
    const data = await pdfParse(buffer);
    return this.normalizeText(data.text);
  }

  async parseDocx(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return this.normalizeText(result.value);
  }

  async parseXlsx(buffer: Buffer): Promise<string> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    let fullText = '';

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      fullText += `Sheet: ${sheetName}\n`;

      // Convert to CSV format (works well for LLM ingestion)
      const csv = XLSX.utils.sheet_to_csv(sheet);
      fullText += csv + '\n\n';
    }

    return this.normalizeText(fullText);
  }

  async parsePptx(buffer: Buffer): Promise<string> {
    const text = await officeParser.parseOffice(buffer);
    return this.normalizeText(text);
  }

  async parseHtml(buffer: Buffer): Promise<string> {
    const html = buffer.toString('utf-8');
    const $ = cheerio.load(html);

    // Remove script, style, nav, footer, header
    $('script, style, nav, footer, header').remove();

    // Extract text from body
    const text = $('body').text() || $.text();
    return this.normalizeText(text);
  }

  async parseDocument(buffer: Buffer, mimeType: string): Promise<string> {
    const mimeLower = mimeType.toLowerCase();

    try {
      if (mimeLower === 'application/pdf') {
        return await this.parsePdf(buffer);
      }

      if (
        mimeLower ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        return await this.parseDocx(buffer);
      }

      if (
        mimeLower ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ) {
        return await this.parseXlsx(buffer);
      }

      if (
        mimeLower ===
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ) {
        return await this.parsePptx(buffer);
      }

      if (mimeLower === 'text/html') {
        return await this.parseHtml(buffer);
      }

      if (mimeLower.startsWith('text/')) {
        return this.normalizeText(buffer.toString('utf-8'));
      }

      throw new Error(`Unsupported MIME type: ${mimeType}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to parse document: ${errorMessage}`);
    }
  }
}
