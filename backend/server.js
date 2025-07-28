const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// In-memory storage for processed documents
let documents = [];

// Helper function to convert image to base64
function fileToGenerativePart(path, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(path)).toString("base64"),
      mimeType
    },
  };
}

// Enhanced image preprocessing for Bengali text
async function preprocessImage(imagePath) {
  const outputPath = imagePath.replace(/\.(jpg|jpeg|png)$/i, '_processed.jpg');
  
  await sharp(imagePath)
    .resize(4000, null, { withoutEnlargement: true })
    .normalize()
    .sharpen({ sigma: 2.0 })
    .modulate({ brightness: 1.2, contrast: 1.3 })
    .gamma(1.2)
    .jpeg({ quality: 100 })
    .toFile(outputPath);
    
  return outputPath;
}

// Helper function to clean and extract JSON from AI response
function extractAndCleanJSON(text) {
  try {
    // Find a JSON block enclosed in markdown
    const match = text.match(/``````/);
    
    let jsonText = text;
    if (match && match[1]) {
      // If markdown is found, use the content inside it.
      jsonText = match[1];
    } else {
      // Otherwise, find the first '{' and the last '}'
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}') + 1;
      
      if (jsonStart === -1 || jsonEnd <= jsonStart) {
        throw new Error('No valid JSON object found in the text.');
      }
      
      jsonText = text.substring(jsonStart, jsonEnd);
    }
    
    // Attempt to parse the extracted text
    return JSON.parse(jsonText);
  } catch (error) {
    console.error('JSON extraction failed:', error.message);
    console.error('Problematic text snippet for debugging:', text.substring(0, 500));
    return null;
  }
}

// Step 1: Extract all text first
async function extractAllText(imagePart) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
  const textExtractionPrompt = `
  Please extract ALL text from this Bengali newspaper image. 
  Focus on accuracy and preserving Bengali Unicode characters.
  
  Rules:
  1. Extract every visible text element
  2. Preserve Bengali font and formatting
  3. Use --- to separate different sections/columns
  4. Use === to separate different articles
  5. Identify text hierarchy (larger text = headlines, smaller text = body)
  6. Don't try to structure - just extract everything you can see
  
  Extract in this format:
  LARGE_TEXT: [any large/bold text you see]
  MEDIUM_TEXT: [medium sized text]
  SMALL_TEXT: [smaller body text]
  OTHER_TEXT: [any other text elements]
  `;


  try {
    const result = await model.generateContent([textExtractionPrompt, imagePart]);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Text extraction error:', error);
    throw new Error('Failed to extract text from image');
  }
}

// Step 2: Structure the extracted text with JSON Mode
async function structureText(extractedText) {
  // Configure the model to output JSON
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: {
        responseMimeType: "application/json",
    }
  });
  
  const structurePrompt = `
  Based on the following extracted text from a Bengali newspaper, identify and structure the content.
  You must respond with only a valid JSON object. Do not include any other text or markdown.

  EXTRACTED TEXT:
  ${extractedText.substring(0, 4000)} 

  Use "অজানা" for any unknown values.
  The JSON schema you must follow is:
  {
    "date": "string",
    "headlines": ["string"],
    "subHeadlines": ["string"],
    "articles": [
      {
        "headline": "string",
        "content": "string",
        "category": "string"
      }
    ],
    "allText": "string"
  }
  `;


  try {
    const result = await model.generateContent([structurePrompt]);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Text structuring error:', error);
    throw new Error('Failed to structure text');
  }
}

// Step 3: Generate summaries for headlines and articles with JSON Mode
async function generateSummaries(structuredData) {
  // Configure the model to output JSON
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: {
        responseMimeType: "application/json",
    }
  });
  
  // Limit the data size to prevent token issues
  const limitedData = {
    ...structuredData,
    allText: structuredData.allText?.substring(0, 1000) || "",
    articles: structuredData.articles?.slice(0, 3) || []
  };
  
  const summaryPrompt = `
  Create a summary for this Bengali newspaper content. You must respond with only a valid JSON object.
  Do not include any other text or markdown.

  DATA: ${JSON.stringify(limitedData)}

  The JSON schema you must follow is:
  {
    "overallSummary": "string",
    "headlineSummaries": [
      {
        "headline": "string",
        "summary": "string"
      }
    ],
    "articleSummaries": [
      {
        "headline": "string",
        "summary": "string",
        "keyPoints": ["string"],
        "category": "string"
      }
    ],
    "importantTopics": ["string"]
  }
  `;

  try {
    const result = await model.generateContent([summaryPrompt]);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Summary generation error:', error);
    throw new Error('Failed to generate summaries');
  }
}

// Routes

// Test route
app.get('/api', (req, res) => {
  res.json({ 
    message: 'বাংলা সংবাদপত্র ডিজিটাইজার API চালু আছে!',
    message_english: 'Bengali Newspaper Digitizer API is running!',
    features: [
      'Text extraction',
      'Headline detection', 
      'Article summarization',
      'Bengali content analysis'
    ],
    endpoints: [
      'POST /api/upload',
      'GET /api/documents', 
      'GET /api/documents/:id',
      'GET /api/search',
      'DELETE /api/documents/:id',
      'GET /api/documents/:id/summary'
    ]
  });
});

// Upload and process Bengali newspaper image with improved error handling
app.post('/api/upload', upload.single('newspaper'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('Processing file:', req.file.originalname);
    
    const imagePath = req.file.path;
    const processedImagePath = await preprocessImage(imagePath);
    
    // Convert to format for Gemini
    const imagePart = fileToGenerativePart(processedImagePath, req.file.mimetype);
    
    console.log('Step 1: Extracting all text...');
    const allText = await extractAllText(imagePart);
    console.log('Extracted text length:', allText.length);
    
    console.log('Step 2: Structuring text...');
    let processedData = {
      date: "অজানা",
      headlines: [],
      subHeadlines: [],
      articles: [],
      allText: allText,
      language: "bengali",
      extractionMethod: "fallback"
    };

    try {
      const structuredText = await structureText(allText);
      console.log('Raw structured response:', structuredText.substring(0, 500) + '...');
      
      const parsedData = extractAndCleanJSON(structuredText);
      if (parsedData) {
        processedData = { ...processedData, ...parsedData, allText: allText }; // Ensure allText is preserved
        processedData.extractionMethod = "ai_structured";
        console.log('Successfully parsed structured data');
      } else {
        throw new Error('Failed to parse structured data from AI response');
      }
    } catch (structureError) {
      console.error('Structure parsing error:', structureError.message);
      
      // Fallback: Extract headlines using regex from the initial extraction
      const headlineMatches = allText.match(/LARGE_TEXT:\s*([^\n]+)/g) || [];
      const extractedHeadlines = headlineMatches
        .map(match => match.replace('LARGE_TEXT:', '').trim())
        .filter(h => h.length > 0);
      
      if (extractedHeadlines.length > 0) {
        processedData.headlines = extractedHeadlines;
        processedData.extractionMethod = "regex_fallback";
      }
    }

    console.log('Step 3: Generating summaries...');
    let summaryData = {
      overallSummary: "সংবাদপত্রের বিষয়বস্তু সফলভাবে প্রক্রিয়া করা হয়েছে।",
      headlineSummaries: [],
      articleSummaries: [],
      importantTopics: ["বিষয়বস্তু বিশ্লেষণ করা হয়েছে"]
    };

    try {
      const summaryResponse = await generateSummaries(processedData);
      console.log('Raw summary response:', summaryResponse.substring(0, 300) + '...');
      
      const parsedSummary = extractAndCleanJSON(summaryResponse);
      if (parsedSummary) {
        summaryData = parsedSummary;
        console.log('Successfully generated AI summaries');
      } else {
        throw new Error('Failed to parse summary data from AI response');
      }
    } catch (summaryError) {
      console.error('Summary generation error:', summaryError.message);
      
      // Create fallback summaries if AI fails
      summaryData.headlineSummaries = processedData.headlines.map(headline => ({
        headline: headline,
        summary: "এই শিরোনামের জন্য একটি স্বয়ংক্রিয় সারাংশ তৈরি করা যায়নি।"
      }));
      
      summaryData.articleSummaries = (processedData.articles || []).map(article => ({
        headline: article.headline || "অজানা শিরোনাম",
        summary: article.content ? article.content.substring(0, 150) + "..." : "নিবন্ধের সারাংশ পাওয়া যায়নি।",
        keyPoints: ["মূল বিষয়বস্তু নির্ধারণ করা যায়নি"],
        category: article.category || "অজানা"
      }));
    }

    // Create the final document record
    const document = {
      id: Date.now().toString(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      imagePath: `/uploads/${req.file.filename}`,
      processedImagePath: `/uploads/${path.basename(processedImagePath)}`,
      uploadDate: new Date().toISOString(),
      extractedData: processedData,
      summaryData: summaryData,
      rawExtractedText: allText.substring(0, 5000), // Limit stored text for performance
      status: 'processed',
      language: 'bengali'
    };

    documents.push(document);

    res.json({
      success: true,
      document: document,
      message: 'বাংলা সংবাদপত্র সফলভাবে প্রক্রিয়া করা হয়েছে',
      headlinesFound: processedData.headlines.length,
      summariesGenerated: true,
      extractionMethod: processedData.extractionMethod,
      overallSummary: summaryData.overallSummary
    });

  } catch (error) {
    console.error('Fatal error in /api/upload:', error);
    res.status(500).json({ 
      error: 'Failed to process Bengali image', 
      details: error.message,
      bangla_error: 'বাংলা ছবি প্রক্রিয়া করতে মারাত্মক ত্রুটি ঘটেছে'
    });
  }
});

// Get all documents
app.get('/api/documents', (req, res) => {
  res.json(documents);
});

// Get specific document
app.get('/api/documents/:id', (req, res) => {
  const document = documents.find(d => d.id === req.params.id);
  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }
  res.json(document);
});

// Get document summary only
app.get('/api/documents/:id/summary', (req, res) => {
  const document = documents.find(d => d.id === req.params.id);
  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }
  
  res.json({
    id: document.id,
    originalName: document.originalName,
    uploadDate: document.uploadDate,
    summaryData: document.summaryData,
    headlinesCount: document.extractedData.headlines?.length || 0,
    articlesCount: document.extractedData.articles?.length || 0
  });
});

// Enhanced search with Bengali support
app.get('/api/search', (req, res) => {
  const query = req.query.q?.toLowerCase();
  if (!query) {
    return res.json([]);
  }

  const results = documents.filter(doc => {
    try {
      const searchText = [
        doc.extractedData.allText || '',
        doc.extractedData.headlines?.join(' ') || '',
        doc.extractedData.articles?.map(a => (a.headline || '') + ' ' + (a.content || '')).join(' ') || '',
        doc.summaryData?.overallSummary || '',
        doc.summaryData?.headlineSummaries?.map(s => s.summary || '').join(' ') || '',
        doc.summaryData?.articleSummaries?.map(s => s.summary || '').join(' ') || ''
      ].join(' ').toLowerCase();
      
      // Check both lowercased and original case for broader matching
      return searchText.includes(query) || 
             (doc.extractedData.allText && doc.extractedData.allText.includes(req.query.q));
    } catch (error) {
      console.error('Search error for document:', doc.id, error);
      return false;
    }
  });

  res.json(results);
});

// Generate summary for existing document
app.post('/api/documents/:id/generate-summary', async (req, res) => {
  try {
    const document = documents.find(d => d.id === req.params.id);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    console.log('Regenerating summary for document:', document.id);
    
    const summaryResponse = await generateSummaries(document.extractedData);
    const parsedSummary = extractAndCleanJSON(summaryResponse);
    
    if (parsedSummary) {
      // Update document with new summary
      const docIndex = documents.findIndex(d => d.id === req.params.id);
      documents[docIndex].summaryData = parsedSummary;
      
      res.json({
        success: true,
        message: 'Summary regenerated successfully',
        summaryData: parsedSummary
      });
    } else {
      throw new Error('Failed to parse regenerated summary');
    }
    
  } catch (error) {
    console.error('Error regenerating summary:', error);
    res.status(500).json({ 
      error: 'Failed to regenerate summary', 
      details: error.message 
    });
  }
});

// Delete document
app.delete('/api/documents/:id', (req, res) => {
  const index = documents.findIndex(d => d.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const document = documents[index];
  
  // Delete associated image files
  try {
    const originalFilePath = path.join(__dirname, 'uploads', document.filename);
    if (fs.existsSync(originalFilePath)) {
      fs.unlinkSync(originalFilePath);
    }
    const processedFilePath = path.join(__dirname, 'uploads', path.basename(document.processedImagePath));
    if (fs.existsSync(processedFilePath)) {
      fs.unlinkSync(processedFilePath);
    }
  } catch (error) {
    console.error('Error deleting files:', error);
    // Don't block the deletion of the record if file removal fails
  }

  documents.splice(index, 1);
  res.json({ success: true, message: 'Document and associated files deleted.' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('বাংলা সংবাদপত্র ডিজিটাইজার সার্ভার চালু');
  console.log('Features: OCR + Bengali Summarization with Enhanced Error Handling and JSON Mode');
  console.log('Make sure to set GEMINI_API_KEY in your .env file');
});
