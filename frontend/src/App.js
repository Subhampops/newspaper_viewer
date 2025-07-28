import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import './App.css';

const API_BASE = 'http://localhost:5000/api';

// Utility to highlight all occurrences of searchQuery in a text (case-insensitive, Unicode-aware)
function highlightText(text, query) {
  if (!query?.trim() || !text) return text;
  // Escape RegExp special chars
  const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    // RegExp with 'gu' for global & Unicode, case-insensitive
    const regex = new RegExp(safeQuery, 'giu');
    let matchIndices = [];
    let match;
    // Get all matches to avoid repeated call to .match in reduce
    while ((match = regex.exec(text)) !== null) {
      matchIndices.push({ start: match.index, end: regex.lastIndex, value: match[0] });
    }
    if (matchIndices.length === 0) return text;
    let fragments = [];
    let lastIndex = 0;
    matchIndices.forEach((m, i) => {
      fragments.push(text.slice(lastIndex, m.start));
      fragments.push(
        <mark key={i} style={{ background: '#c6f3f2', color: '#b80000' }}>
          {m.value}
        </mark>
      );
      lastIndex = m.end;
    });
    fragments.push(text.slice(lastIndex));
    return fragments;
  } catch (e) {
    // fallback: return original if regex fails
    return text;
  }
}

function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [view, setView] = useState('upload'); // 'upload', 'browse', 'search'

  useEffect(() => { fetchDocuments(); }, []);

  const fetchDocuments = async () => {
    try {
      const response = await axios.get(`${API_BASE}/documents`);
      setDocuments(response.data);
    } catch (error) {
      console.error('Error fetching documents:', error);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('newspaper', file);

    try {
      const response = await axios.post(`${API_BASE}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (response.data.success) {
        setSelectedDocument(response.data.document);
        setView('browse');
        await fetchDocuments();
      }
    } catch (error) {
      alert('Error uploading file');
    } finally {
      setUploading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const response = await axios.get(`${API_BASE}/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(response.data);
      setView('search');
      setSelectedDocument(null);
    } catch (error) {
      alert('Error searching');
    }
  };

  // Side-by-side display for selected document
  function renderDocumentDetails(document) {
    if (!document) return null;

    // Only highlight if searchQuery is set and from search view
    const highlight = view === 'search' && searchQuery?.trim();

    return (
      <div className="details-container">
        <div className="image-column">
          <TransformWrapper initialScale={1} maxScale={3}>
            <TransformComponent>
              <img
                src={`http://localhost:5000${document.imagePath}`}
                alt=""
                className="newspaper-image"
              />
            </TransformComponent>
          </TransformWrapper>
        </div>
        <div className="data-column">
          <h4>🗓️ তারিখঃ {document.extractedData.date}</h4>
          <div>
            <strong>📰 শিরোনাম সমূহ:</strong>
            <ul>
              {document.extractedData.headlines &&
                document.extractedData.headlines.map((headline, i) => (
                  <li key={i}>
                    {highlight ? highlightText(headline, searchQuery) : headline}
                  </li>
                ))}
            </ul>
          </div>
          <div>
            <strong>📑 প্রবন্ধসমূহ:</strong>
            {(document.extractedData.articles || []).map((art, i) => (
              <div className="article-box" key={i}>
                <div className="headline">
                  {highlight ? highlightText(art.headline, searchQuery) : art.headline}
                </div>
                <div className="category">বিভাগ: <span>{art.category}</span></div>
                {art.summary && (
                  <div className="summary">সারাংশ: <span>{art.summary}</span></div>
                )}
                <div className="content">
                  {highlight ? highlightText(art.content, searchQuery) : art.content}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => setSelectedDocument(null)} style={{marginTop:'2em'}}>বন্ধ করুন</button>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="abp-header">
        <h1>আনন্দবাজার পত্রিকা</h1>
        <div className="abp-tabs">
          <button className={view === 'upload' ? 'active' : ''} onClick={() => {setView('upload'); setSelectedDocument(null);}}>আপলোড</button>
          <button className={view === 'browse' ? 'active' : ''} onClick={() => {setView('browse'); setSelectedDocument(null);}}>দেখুন</button>
          <button className={view === 'search' ? 'active' : ''} onClick={() => setView('search')}>অনুসন্ধান</button>
        </div>
        {view === 'search' && (
          <div className="abp-searchbar">
            <input
              type="text"
              placeholder="অনুসন্ধান করুন..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <button onClick={handleSearch}>Go</button>
          </div>
        )}
      </header>

      <main className="abp-main">
        {view === 'upload' && (
          <div className="abp-upload">
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              disabled={uploading}
            />
            {uploading && <div style={{color: 'red', marginTop: '1em'}}>প্রসেসিং হচ্ছে...</div>}
            <p style={{marginTop: 20}}>একটি সংবাদপত্রের ছবি আপলোড করুন।</p>
          </div>
        )}

        {view === 'browse' && !selectedDocument && (
          <div>
            <h3>ডকুমেন্টস ({documents.length})</h3>
            <ul>
              {documents.map(doc => (
                <li key={doc.id}>
                  <button onClick={() => setSelectedDocument(doc)} style={{marginRight: 10}}>{doc.originalName}</button>
                  <span>({doc.extractedData.date})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Side-by-side */}
        {view === 'browse' && selectedDocument && renderDocumentDetails(selectedDocument)}

        {view === 'search' && !selectedDocument && (
          <div>
            <h3>অনুসন্ধান ফলাফল:</h3>
            {searchResults.length === 0
              ? <p>কিছুই পাওয়া যায়নি।</p>
              : (
                <ul>
                  {searchResults.map(doc => (
                    <li key={doc.id}>
                      <button
                        style={{marginRight:'1em'}}
                        onClick={()=>setSelectedDocument(doc)}
                      >
                        {doc.originalName}
                      </button>
                      <span>{doc.extractedData.date}</span>
                    </li>
                  ))}
                </ul>
              )
            }
          </div>
        )}

        {view === 'search' && selectedDocument && renderDocumentDetails(selectedDocument)}
      </main>
    </div>
  );
}

export default App;
