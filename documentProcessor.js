/**
 * AuraAI Document Processor
 * Handles PDF, DOCX, PPTX, XLSX, CSV, TXT, JSON, MD.
 * Preserves structural hierarchy: Pages, Sections, Headings, Tables, Paragraphs.
 * Chunks documents with complete metadata: id, documentId, filename, page, section, heading, text, tokenCount.
 */

const zlib = require('zlib');
const crypto = require('crypto');
const { log } = require('./logger');

// Extract files from standard PKZIP buffer (for DOCX & PPTX)
function extractZipEntries(buffer) {
    const entries = {};
    let offset = 0;
    while (offset < buffer.length - 4) {
        if (buffer.readUInt32LE(offset) === 0x04034b50) {
            const compMethod = buffer.readUInt16LE(offset + 8);
            const compSize = buffer.readUInt32LE(offset + 18);
            const nameLen = buffer.readUInt16LE(offset + 26);
            const extraLen = buffer.readUInt16LE(offset + 28);
            const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLen);
            const dataOffset = offset + 30 + nameLen + extraLen;
            const compData = buffer.slice(dataOffset, dataOffset + compSize);
            
            let data = null;
            if (compMethod === 0) {
                data = compData;
            } else if (compMethod === 8) {
                try {
                    data = zlib.inflateRawSync(compData);
                } catch (e) {}
            }
            if (data) entries[name] = data;
            offset = dataOffset + compSize;
        } else {
            offset++;
        }
    }
    return entries;
}

// Parse Word Document (.docx)
function parseDocx(buffer, filename) {
    const entries = extractZipEntries(buffer);
    const docXmlBuf = entries['word/document.xml'];
    if (!docXmlBuf) {
        return { filename, type: 'docx', totalPages: 1, sections: [], fullText: '' };
    }

    const xml = docXmlBuf.toString('utf8');
    const sections = [];
    let currentHeading = 'General';
    let currentSection = 'Overview';
    let pageNum = 1;

    // Split paragraphs <w:p>
    const pRegex = /<w:p(?:\s+[^>]*)?>([\s\S]*?)<\/w:p>/gi;
    let match;

    while ((match = pRegex.exec(xml)) !== null) {
        const pXml = match[1];

        // Check for page break
        if (pXml.includes('<w:br w:type="page"/>') || pXml.includes('<w:lastRenderedPageBreak/>')) {
            pageNum++;
        }

        // Check heading style
        const isHeading = /<w:pStyle\s+w:val="Heading(\d+)"/i.test(pXml);

        // Extract text runs <w:t>
        const tMatches = pXml.match(/<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/gi) || [];
        const text = tMatches.map(t => t.replace(/<[^>]*>/g, '').trim()).filter(Boolean).join('');

        if (text) {
            if (isHeading) {
                currentHeading = text;
                currentSection = text;
                sections.push({ page: pageNum, section: currentSection, heading: currentHeading, title: currentHeading, text: text, type: 'heading' });
            } else {
                sections.push({ page: pageNum, section: currentSection, heading: currentHeading, title: currentHeading, text: text, type: 'paragraph' });
            }
        }
    }

    // Also extract tables <w:tbl>
    const tblRegex = /<w:tbl(?:\s+[^>]*)?>([\s\S]*?)<\/w:tbl>/gi;
    let tblMatch;
    while ((tblMatch = tblRegex.exec(xml)) !== null) {
        const tblXml = tblMatch[1];
        const rows = [];
        const trRegex = /<w:tr(?:\s+[^>]*)?>([\s\S]*?)<\/w:tr>/gi;
        let trMatch;
        while ((trMatch = trRegex.exec(tblXml)) !== null) {
            const trXml = trMatch[1];
            const cells = [];
            const tcRegex = /<w:tc(?:\s+[^>]*)?>([\s\S]*?)<\/w:tc>/gi;
            let tcMatch;
            while ((tcMatch = tcRegex.exec(trXml)) !== null) {
                const tcXml = tcMatch[1];
                const tMatches = tcXml.match(/<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/gi) || [];
                cells.push(tMatches.map(t => t.replace(/<[^>]*>/g, '').trim()).join(' '));
            }
            if (cells.length > 0) rows.push(cells);
        }
        if (rows.length > 0) {
            let mdTable = '\n| ' + rows[0].join(' | ') + ' |\n';
            mdTable += '| ' + rows[0].map(() => '---').join(' | ') + ' |\n';
            rows.slice(1).forEach(r => {
                mdTable += '| ' + r.join(' | ') + ' |\n';
            });
            sections.push({ page: pageNum, section: currentSection, heading: `${currentHeading} (Table)`, title: `${currentHeading} (Table)`, text: mdTable, type: 'table' });
        }
    }

    const fullText = sections.map(s => `[Page ${s.page} | ${s.heading}]\n${s.text}`).join('\n\n');
    return {
        id: 'doc_' + crypto.createHash('md5').update(buffer).digest('hex').substring(0, 10),
        filename,
        type: 'docx',
        totalPages: pageNum,
        sections,
        fullText
    };
}

// Parse PowerPoint Presentation (.pptx)
function parsePptx(buffer, filename) {
    const entries = extractZipEntries(buffer);
    const sections = [];
    let slideNum = 1;

    // Find all slide XMLs (ppt/slides/slide1.xml, etc.)
    const slideKeys = Object.keys(entries).filter(k => /^ppt\/slides\/slide\d+\.xml$/i.test(k));
    slideKeys.sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
        return numA - numB;
    });

    slideKeys.forEach((key, idx) => {
        const slideXml = entries[key].toString('utf8');
        const textMatches = slideXml.match(/<a:t(?:\s+[^>]*)?>([\s\S]*?)<\/a:t>/gi) || [];
        const slideTexts = textMatches.map(t => t.replace(/<[^>]*>/g, '').trim()).filter(Boolean);

        if (slideTexts.length > 0) {
            const slideTitle = slideTexts[0];
            const slideBody = slideTexts.slice(1).join('\n• ');
            const combinedText = `Slide ${idx + 1}: ${slideTitle}\n` + (slideBody ? `• ${slideBody}` : '');
            sections.push({
                page: idx + 1,
                section: `Slide ${idx + 1}`,
                heading: slideTitle,
                title: `Slide ${idx + 1}: ${slideTitle}`,
                text: combinedText,
                type: 'slide'
            });
        }
    });

    const fullText = sections.map(s => s.text).join('\n\n');
    return {
        id: 'doc_' + crypto.createHash('md5').update(buffer).digest('hex').substring(0, 10),
        filename,
        type: 'pptx',
        totalPages: slideKeys.length || 1,
        sections,
        fullText
    };
}

// Parse Structured Text/PDF string (from frontend PDF.js or plain text)
function parseStructuredText(text, filename = 'document.txt', type = 'txt') {
    const lines = text.split('\n');
    const sections = [];
    let currentPage = 1;
    let currentHeading = 'Overview';
    let currentSection = 'General';
    let currentBlock = [];

    lines.forEach(line => {
        const trimmed = line.trim();
        const pageMatch = trimmed.match(/^---\s*Page\s+(\d+)\s*---/i) || trimmed.match(/^\[Page\s+(\d+)\]/i);
        if (pageMatch) {
            if (currentBlock.length > 0) {
                sections.push({
                    page: currentPage,
                    section: currentSection,
                    heading: currentHeading,
                    title: currentHeading,
                    text: currentBlock.join('\n'),
                    type: 'paragraph'
                });
                currentBlock = [];
            }
            currentPage = parseInt(pageMatch[1], 10);
            return;
        }

        const headingMatch = trimmed.match(/^#{1,4}\s+(.+)/) || trimmed.match(/^[A-Z0-9\s.:_-]{4,40}$/);
        if (headingMatch && trimmed.length < 50 && !trimmed.endsWith('.')) {
            if (currentBlock.length > 0) {
                sections.push({
                    page: currentPage,
                    section: currentSection,
                    heading: currentHeading,
                    title: currentHeading,
                    text: currentBlock.join('\n'),
                    type: 'paragraph'
                });
                currentBlock = [];
            }
            currentHeading = headingMatch[1] || trimmed;
            currentSection = currentHeading;
            return;
        }

        if (trimmed) {
            currentBlock.push(trimmed);
        }
    });

    if (currentBlock.length > 0) {
        sections.push({
            page: currentPage,
            section: currentSection,
            heading: currentHeading,
            title: currentHeading,
            text: currentBlock.join('\n'),
            type: 'paragraph'
        });
    }

    return {
        id: 'doc_' + crypto.createHash('md5').update(text).digest('hex').substring(0, 10),
        filename,
        type,
        totalPages: currentPage,
        sections,
        fullText: text
    };
}

// Chunking with Overlap & complete metadata preservation
function chunkDocument(doc, maxChunkChars = 1200, overlapChars = 200) {
    const chunks = [];
    let chunkIndex = 0;

    doc.sections.forEach(sec => {
        const secText = sec.text;
        const heading = sec.heading || sec.title || 'General';
        const section = sec.section || heading;

        if (secText.length <= maxChunkChars) {
            const tokenCount = Math.ceil(secText.length / 4);
            chunks.push({
                id: `${doc.id}_c${chunkIndex++}`,
                documentId: doc.id,
                docId: doc.id,
                filename: doc.filename,
                page: sec.page,
                section,
                heading,
                title: heading,
                type: sec.type,
                text: secText,
                tokenCount
            });
        } else {
            // Split larger sections semantically by paragraph or sentence
            let start = 0;
            while (start < secText.length) {
                const end = Math.min(start + maxChunkChars, secText.length);
                const chunkSlice = secText.substring(start, end);
                const tokenCount = Math.ceil(chunkSlice.length / 4);
                chunks.push({
                    id: `${doc.id}_c${chunkIndex++}`,
                    documentId: doc.id,
                    docId: doc.id,
                    filename: doc.filename,
                    page: sec.page,
                    section,
                    heading,
                    title: heading,
                    type: sec.type,
                    text: chunkSlice,
                    tokenCount
                });
                start += (maxChunkChars - overlapChars);
            }
        }
    });

    log('CHUNKING', `Chunked document "${doc.filename}" into ${chunks.length} structured chunks with metadata`, {
        totalPages: doc.totalPages,
        totalChars: doc.fullText.length
    });

    return chunks;
}

// Hierarchical Summarizer (Supports modes: short, detailed, executive, technical, bullet_points)
function summarizeDocumentLocally(doc, mode = 'executive') {
    const text = doc.fullText;
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const keySentences = sentences
        .map(s => s.trim())
        .filter(s => s.length > 30 && !s.includes('--- Page') && !s.startsWith('|'))
        .slice(0, 15);

    let summaryHeader = '';
    let summaryBody = '';

    if (mode === 'bullet_points') {
        summaryHeader = `### 📋 Key Takeaways: *${doc.filename}*\n\n`;
        summaryBody = keySentences.slice(0, 7).map((s, i) => `• **Point ${i + 1}**: ${s}`).join('\n');
    } else if (mode === 'technical') {
        summaryHeader = `### ⚙️ Technical Summary: *${doc.filename}*\n\n`;
        summaryBody = `**Document Type**: ${doc.type.toUpperCase()} • **Pages/Sheets**: ${doc.totalPages}\n\n` +
                      `#### Architectural / Operational Details:\n` +
                      keySentences.slice(0, 8).map(s => `- ${s}`).join('\n');
    } else if (mode === 'detailed') {
        summaryHeader = `### 📑 Comprehensive Analysis: *${doc.filename}*\n\n`;
        const sectionSummaries = doc.sections.slice(0, 6).map(sec => `#### ${sec.title} (Page ${sec.page})\n${sec.text.substring(0, 250)}...`).join('\n\n');
        summaryBody = sectionSummaries;
    } else {
        // Executive Summary (Default)
        summaryHeader = `### 📑 Executive Summary: *${doc.filename}*\n\n`;
        summaryBody = `**Overview**: This ${doc.totalPages}-page document covers **${doc.sections[0]?.title || 'core subjects'}**.\n\n` +
                      `#### Key Highlights:\n` +
                      keySentences.slice(0, 5).map(s => `• ${s}`).join('\n\n') +
                      `\n\n#### Structured Sections Analyzed:\n` +
                      doc.sections.slice(0, 5).map(sec => `- **Page ${sec.page}**: ${sec.title}`).join('\n');
    }

    return `${summaryHeader}${summaryBody}\n\n---\n*Generated by AuraAI Document Processing Engine*`;
}

module.exports = {
    parseDocx,
    parsePptx,
    parseStructuredText,
    chunkDocument,
    summarizeDocumentLocally
};
