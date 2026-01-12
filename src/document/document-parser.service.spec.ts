import { Test, TestingModule } from '@nestjs/testing';
import { DocumentParserService } from './document-parser.service';

// Mock the modules before importing
jest.mock('pdf-parse', () => jest.fn());
jest.mock('mammoth', () => ({ extractRawText: jest.fn() }));
jest.mock('xlsx', () => ({
  read: jest.fn(),
  utils: { sheet_to_csv: jest.fn() },
}));
jest.mock('officeparser', () => ({ parseOffice: jest.fn() }));
jest.mock('cheerio', () => ({ load: jest.fn() }));

// Import the mocked modules
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import * as officeParser from 'officeparser';
import * as cheerio from 'cheerio';

describe('DocumentParserService', () => {
  let service: DocumentParserService;
  let mockPdfParse: jest.MockedFunction<any>;
  let mockMammoth: jest.Mocked<typeof mammoth>;
  let mockXLSX: jest.Mocked<typeof XLSX>;
  let mockOfficeParser: jest.Mocked<typeof officeParser>;
  let mockCheerio: jest.Mocked<typeof cheerio>;

  beforeEach(async () => {
    // Override the mocked modules with proper implementations
    Object.assign(pdfParse, jest.fn());
    mockPdfParse = pdfParse as jest.MockedFunction<any>;
    mockMammoth = mammoth as jest.Mocked<typeof mammoth>;
    mockXLSX = XLSX as jest.Mocked<typeof XLSX>;
    mockOfficeParser = officeParser;
    mockCheerio = cheerio as jest.Mocked<typeof cheerio>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [DocumentParserService],
    }).compile();

    service = module.get<DocumentParserService>(DocumentParserService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('parsePdf', () => {
    it('should parse PDF buffer and return normalized text', async () => {
      const mockBuffer = Buffer.from('test pdf');
      const mockPdfData = { text: 'Sample PDF text\n\n\nwith    spacing' };

      mockPdfParse.mockResolvedValue(mockPdfData as any);

      const result = await service.parsePdf(mockBuffer);

      expect(mockPdfParse).toHaveBeenCalledWith(mockBuffer);
      expect(result).toBe('Sample PDF text\n\nwith spacing');
    });

    it('should handle PDF with excessive whitespace', async () => {
      const mockBuffer = Buffer.from('test pdf');
      const mockPdfData = { text: 'Text\n\n\n\n\nwith\n\n\n\nmany     spaces' };

      mockPdfParse.mockResolvedValue(mockPdfData as any);

      const result = await service.parsePdf(mockBuffer);

      expect(result).not.toContain('\n\n\n');
      expect(result).not.toContain('     ');
    });

    it('should trim leading and trailing whitespace', async () => {
      const mockBuffer = Buffer.from('test pdf');
      const mockPdfData = { text: '   Text with padding   ' };

      mockPdfParse.mockResolvedValue(mockPdfData as any);

      const result = await service.parsePdf(mockBuffer);

      expect(result).toBe('Text with padding');
    });
  });

  describe('parseDocx', () => {
    it('should parse DOCX buffer and return normalized text', async () => {
      const mockBuffer = Buffer.from('test docx');
      const mockResult = { value: 'Sample DOCX text\n\n\nwith    spacing' };

      mockMammoth.extractRawText.mockResolvedValue(mockResult);

      const result = await service.parseDocx(mockBuffer);

      expect(mockMammoth.extractRawText).toHaveBeenCalledWith({
        buffer: mockBuffer,
      });
      expect(result).toBe('Sample DOCX text\n\nwith spacing');
    });

    it('should handle empty DOCX', async () => {
      const mockBuffer = Buffer.from('test docx');
      const mockResult = { value: '' };

      mockMammoth.extractRawText.mockResolvedValue(mockResult);

      const result = await service.parseDocx(mockBuffer);

      expect(result).toBe('');
    });
  });

  describe('parseXlsx', () => {
    it('should parse XLSX buffer and return CSV format text', async () => {
      const mockBuffer = Buffer.from('test xlsx');
      const mockSheet = { A1: { v: 'Header1' }, B1: { v: 'Header2' } };
      const mockWorkbook = {
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: mockSheet },
      };

      mockXLSX.read.mockReturnValue(mockWorkbook);
      mockXLSX.utils.sheet_to_csv.mockReturnValue(
        'Header1,Header2\nValue1,Value2',
      );

      const result = await service.parseXlsx(mockBuffer);

      expect(mockXLSX.read).toHaveBeenCalledWith(mockBuffer, {
        type: 'buffer',
      });
      expect(mockXLSX.utils.sheet_to_csv).toHaveBeenCalledWith(mockSheet);
      expect(result).toContain('Sheet: Sheet1');
      expect(result).toContain('Header1,Header2');
    });

    it('should handle multiple sheets', async () => {
      const mockBuffer = Buffer.from('test xlsx');
      const mockWorkbook = {
        SheetNames: ['Sheet1', 'Sheet2'],
        Sheets: {
          Sheet1: {},
          Sheet2: {},
        },
      };

      mockXLSX.read.mockReturnValue(mockWorkbook);
      mockXLSX.utils.sheet_to_csv.mockReturnValue('data');

      const result = await service.parseXlsx(mockBuffer);

      expect(result).toContain('Sheet: Sheet1');
      expect(result).toContain('Sheet: Sheet2');
      expect(mockXLSX.utils.sheet_to_csv).toHaveBeenCalledTimes(2);
    });

    it('should normalize the output text', async () => {
      const mockBuffer = Buffer.from('test xlsx');
      const mockWorkbook = {
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: {} },
      };

      mockXLSX.read.mockReturnValue(mockWorkbook);
      mockXLSX.utils.sheet_to_csv.mockReturnValue(
        'Text\n\n\n\n\nwith     spacing',
      );

      const result = await service.parseXlsx(mockBuffer);

      expect(result).not.toContain('\n\n\n');
      expect(result).not.toContain('     ');
    });
  });

  describe('parsePptx', () => {
    it('should parse PPTX buffer and return normalized text', async () => {
      const mockBuffer = Buffer.from('test pptx');
      const mockText = 'Sample PPTX text\n\n\nwith    spacing';

      (officeParser.parseOffice as jest.Mock).mockResolvedValue(mockText);

      const result = await service.parsePptx(mockBuffer);

      expect(officeParser.parseOffice).toHaveBeenCalledWith(mockBuffer);
      expect(result).toBe('Sample PPTX text\n\nwith spacing');
    });
  });

  describe('parseHtml', () => {
    it('should parse HTML buffer and return text content', async () => {
      const mockHtml = '<html><body><p>Sample text</p></body></html>';
      const mockBuffer = Buffer.from(mockHtml);

      (cheerio.load as jest.Mock).mockImplementation((html: string) => {
        const $ = (selector: string) => {
          if (selector === 'script, style, nav, footer, header') {
            return { remove: jest.fn() };
          }
          if (selector === 'body') {
            return { text: jest.fn().mockReturnValue('Sample text') };
          }
          return { text: jest.fn().mockReturnValue('Sample text') };
        };
        ($ as any).fn = {};
        ($ as any).text = jest.fn().mockReturnValue('Sample text');
        return $;
      });

      const result = await service.parseHtml(mockBuffer);

      expect(cheerio.load).toHaveBeenCalledWith(mockHtml);
      expect(result).toBe('Sample text');
    });

    it('should remove script and style tags', async () => {
      const mockHtml =
        '<html><head><script>alert("hi")</script><style>.test{}</style></head><body><p>Content</p></body></html>';
      const mockBuffer = Buffer.from(mockHtml);

      let removeCalled = false;
      (cheerio.load as jest.Mock).mockImplementation(() => {
        const $ = (selector: string) => {
          if (selector === 'script, style, nav, footer, header') {
            removeCalled = true;
            return { remove: jest.fn() };
          }
          if (selector === 'body') {
            return { text: jest.fn().mockReturnValue('Content') };
          }
          return { text: jest.fn().mockReturnValue('Content') };
        };
        ($ as any).fn = {};
        ($ as any).text = jest.fn().mockReturnValue('Content');
        return $;
      });

      await service.parseHtml(mockBuffer);

      expect(removeCalled).toBe(true);
    });
  });

  describe('parseDocument', () => {
    it('should parse PDF when MIME type is application/pdf', async () => {
      const mockBuffer = Buffer.from('test');
      mockPdfParse.mockResolvedValue({ text: 'PDF text' } as any);

      const result = await service.parseDocument(mockBuffer, 'application/pdf');

      expect(mockPdfParse).toHaveBeenCalledWith(mockBuffer);
      expect(result).toBe('PDF text');
    });

    it('should parse DOCX when MIME type is correct', async () => {
      const mockBuffer = Buffer.from('test');
      mockMammoth.extractRawText.mockResolvedValue({ value: 'DOCX text' });

      const result = await service.parseDocument(
        mockBuffer,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );

      expect(mockMammoth.extractRawText).toHaveBeenCalledWith({
        buffer: mockBuffer,
      });
      expect(result).toBe('DOCX text');
    });

    it('should parse XLSX when MIME type is correct', async () => {
      const mockBuffer = Buffer.from('test');
      const mockWorkbook = {
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: {} },
      };
      mockXLSX.read.mockReturnValue(mockWorkbook);
      mockXLSX.utils.sheet_to_csv.mockReturnValue('data');

      const result = await service.parseDocument(
        mockBuffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      expect(mockXLSX.read).toHaveBeenCalledWith(mockBuffer, {
        type: 'buffer',
      });
      expect(result).toContain('Sheet: Sheet1');
    });

    it('should parse PPTX when MIME type is correct', async () => {
      const mockBuffer = Buffer.from('test');
      mockOfficeParser.parseOffice.mockResolvedValue('PPTX text');

      const result = await service.parseDocument(
        mockBuffer,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      );

      expect(mockOfficeParser.parseOffice).toHaveBeenCalledWith(mockBuffer);
      expect(result).toBe('PPTX text');
    });

    it('should parse HTML when MIME type is text/html', async () => {
      const mockBuffer = Buffer.from('<html><body>Test</body></html>');
      mockCheerio.load.mockImplementation(() => {
        const $ = (selector: string) => {
          if (selector === 'script, style, nav, footer, header') {
            return { remove: jest.fn() };
          }
          if (selector === 'body') {
            return { text: jest.fn().mockReturnValue('Test') };
          }
          return { text: jest.fn().mockReturnValue('Test') };
        };
        ($ as any).fn = {};
        ($ as any).text = jest.fn().mockReturnValue('Test');
        return $;
      });

      const result = await service.parseDocument(mockBuffer, 'text/html');

      expect(result).toBe('Test');
    });

    it('should parse plain text when MIME type starts with text/', async () => {
      const mockBuffer = Buffer.from('Plain text content');

      const result = await service.parseDocument(mockBuffer, 'text/plain');

      expect(result).toBe('Plain text content');
    });

    it('should handle case-insensitive MIME types', async () => {
      const mockBuffer = Buffer.from('test');
      mockPdfParse.mockResolvedValue({ text: 'PDF text' } as any);

      const result = await service.parseDocument(mockBuffer, 'APPLICATION/PDF');

      expect(mockPdfParse).toHaveBeenCalledWith(mockBuffer);
      expect(result).toBe('PDF text');
    });

    it('should throw error for unsupported MIME type', async () => {
      const mockBuffer = Buffer.from('test');

      await expect(
        service.parseDocument(mockBuffer, 'application/octet-stream'),
      ).rejects.toThrow('Unsupported MIME type: application/octet-stream');
    });

    it('should wrap parsing errors with descriptive message', async () => {
      const mockBuffer = Buffer.from('test');
      mockPdfParse.mockRejectedValue(new Error('Parse failed'));

      await expect(
        service.parseDocument(mockBuffer, 'application/pdf'),
      ).rejects.toThrow('Failed to parse document: Parse failed');
    });

    it('should handle unknown errors during parsing', async () => {
      const mockBuffer = Buffer.from('test');
      mockPdfParse.mockRejectedValue('String error');

      await expect(
        service.parseDocument(mockBuffer, 'application/pdf'),
      ).rejects.toThrow('Failed to parse document: Unknown error');
    });
  });
});
