// torrentdownload.js - Fixed for actual RSS format
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import xml2js from 'xml2js';
import https from 'https';

const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: true,
    trim: true
});

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    secureProtocol: 'TLSv1_2_method'
});

// =====================
// Helper Functions
// =====================

function extractInfoHash(magnetLink) {
    if (!magnetLink) return null;
    const match = magnetLink.match(/btih:([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
}

function extractQuality(title) {
    if (!title) return '';
    const qualityPatterns = [
        '2160p', '1080p', '720p', '480p',
        '4k', 'uhd', 'webrip', 'brrip', 
        'hdtv', 'x265', 'h264', 'x264',
        'bluray', 'remux'
    ];
    const regex = new RegExp(`\\b(${qualityPatterns.join('|')})\\b`, 'i');
    const match = title.match(regex);
    return match ? match[1].toLowerCase() : '';
}

function parseSizeToBytes(size) {
    if (!size || size === 'Unknown') return 0;
    const match = size.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
    if (!match) {
        console.log(`⚠️ Size parsing failed for: "${size}"`);
        return 0;
    }
    
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    
    const units = {
        'TB': 1024 ** 4,
        'GB': 1024 ** 3,
        'MB': 1024 ** 2,
        'KB': 1024,
        'B': 1
    };
    
    const bytes = value * (units[unit] || 0);
    return bytes;
}

function generateMagnetLinkFromHash(hash) {
    if (!hash) return null;
    return `magnet:?xt=urn:btih:${hash}`;
}

function cleanSearchQuery(searchQuery) {
    // Remove year from search query if present (e.g., "Movie Title (2023)" -> "Movie Title")
    return searchQuery.replace(/\s*\(\d{4}\)\s*/g, '').trim();
}

function isLikelyMovie(title) {
    // Check if title looks like a movie vs TV show
    const tvPatterns = [
        /S\d{2}E\d{2}/i,           // S01E01
        /\d{1,2}x\d{2}/i,          // 1x01
        /Season\s+\d+/i,           // Season 1
        /Episode\s+\d+/i,          // Episode 1
        /\bEp\s*\d+/i              // Ep1, Ep 1
    ];
    
    return !tvPatterns.some(pattern => title.match(pattern));
}

// =====================
// Main Function
// =====================

async function fetchRSSFeeds(searchQuery, type = 'movie') {
    console.log(`🔍 TorrentDownload: Searching for "${searchQuery}" (type: ${type})`);
    
    // Clean the search query to remove any year information
    const cleanedQuery = cleanSearchQuery(searchQuery);
    const searchTerm = encodeURIComponent(cleanedQuery);
    
    console.log(`🔍 TorrentDownload: Using cleaned search term: "${cleanedQuery}"`);
    
    // Use the correct RSS endpoint format
    const urls = [
        `https://www.torrentdownload.info/feed_s?q=${searchTerm}`,
        `http://www.torrentdownload.info/feed_s?q=${searchTerm}`,
        `https://cors-proxy.viren070.me/?url=${encodeURIComponent(`https://www.torrentdownload.info/feed_s?q=${searchTerm}`)}`
    ];

    for (let urlIndex = 0; urlIndex < urls.length; urlIndex++) {
        const rssUrl = urls[urlIndex];
        console.log(`🌐 Trying URL ${urlIndex + 1}/${urls.length}: ${rssUrl}`);
        
        try {
            const isProxy = rssUrl.includes('cors-proxy');
            const response = await fetch(rssUrl, {
                agent: (!isProxy && rssUrl.startsWith('https')) ? httpsAgent : undefined,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'application/rss+xml,application/xml,text/xml,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                },
                timeout: 15000
            });

            console.log(`📡 Response status: ${response.status}`);
            if (!response.ok) {
                console.log(`❌ Bad response: ${response.status} ${response.statusText}`);
                continue;
            }
            
            const rssData = await response.text();
            console.log(`📄 RSS data length: ${rssData.length} characters`);
            
            // Clean malformed XML more thoroughly
            let cleanRssData = rssData
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                // Fix common HTML entity issues
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                // Remove invalid XML characters
                .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
                // Fix malformed entities (& followed by non-entity text)
                .replace(/&(?![a-zA-Z0-9#]+;)/g, '&amp;')
                // Remove any remaining problematic characters that might break XML parsing
                .replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, '');
            
            const result = await parser.parseStringPromise(cleanRssData);
            if (!result?.rss?.channel?.item) {
                console.log(`❌ No items found in RSS structure`);
                // Log more details about the structure for debugging
                console.log(`📊 Available keys in result:`, Object.keys(result || {}));
                if (result?.rss) {
                    console.log(`📊 Available keys in rss:`, Object.keys(result.rss));
                    if (result.rss.channel) {
                        console.log(`📊 Available keys in channel:`, Object.keys(result.rss.channel));
                    }
                }
                continue;
            }
            
            const items = Array.isArray(result.rss.channel.item) 
                ? result.rss.channel.item 
                : [result.rss.channel.item];
            
            console.log(`📦 TorrentDownload: Found ${items.length} items`);
            
            let movieCount = 0;
            let tvCount = 0;
            let processedCount = 0;
            let filteredOutCount = 0;
            
            const torrents = items.map((item, index) => {
                try {
                    if (!item.title) {
                        console.log(`⚠️ Item ${index}: No title found`);
                        return null;
                    }
                    
                    processedCount++;
                    const isMovie = isLikelyMovie(item.title);
                    if (isMovie) movieCount++; else tvCount++;
                    
                    console.log(`🎬 Item ${index}: "${item.title}" - ${isMovie ? 'MOVIE' : 'TV SHOW'}`);
                    
                    // Parse the description which contains: Size: X GB Seeds: Y , Peers: Z Hash: HASH
                    const description = item.description || '';
                    console.log(`📝 Description: "${description}"`);
                    
                    // Extract size from description
                    const sizeMatch = description.match(/Size:\s*([\d.]+)\s*(GB|MB|TB)/i);
                    const size = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : 'Unknown';
                    const sizeBytes = parseSizeToBytes(size);
                    
                    console.log(`📏 Item ${index}: Size "${size}" -> ${sizeBytes} bytes`);
                    
                    // Extract seeds and peers
                    const seedsMatch = description.match(/Seeds:\s*(\d+)/i);
                    const peersMatch = description.match(/Peers:\s*(\d+)/i);
                    const seeders = seedsMatch ? parseInt(seedsMatch[1]) : 0;
                    const leechers = peersMatch ? parseInt(peersMatch[1]) : 0;
                    
                    console.log(`👥 Item ${index}: ${seeders} seeders, ${leechers} leechers`);
                    
                    // Extract hash from description
                    const hashMatch = description.match(/Hash:\s*([A-Fa-f0-9]{40})/i);
                    const hash = hashMatch ? hashMatch[1] : null;
                    
                    if (!hash) {
                        console.log(`❌ Item ${index}: No hash found in description`);
                        return null;
                    }
                    
                    console.log(`🔗 Item ${index}: Hash found: ${hash}`);
                    
                    // Generate magnet link from hash
                    const magnetLink = generateMagnetLinkFromHash(hash);
                    const infoHash = hash.toLowerCase();
                    
                    // Check size requirements
                    const minSize = type === 'movie' ? 100 * 1024 * 1024 : 50 * 1024 * 1024;
                    const minSizeMB = minSize / (1024 * 1024);
                    const actualSizeMB = sizeBytes / (1024 * 1024);
                    
                    if (sizeBytes <= minSize) {
                        console.log(`❌ Item ${index}: Size too small (${actualSizeMB.toFixed(1)}MB < ${minSizeMB}MB required for ${type})`);
                        filteredOutCount++;
                        return null;
                    }
                    
                    console.log(`✅ Item ${index}: Passed all filters`);
                    
                    return {
                        websiteTitle: item.title,
                        quality: extractQuality(item.title),
                        size: size,
                        magnetLink: magnetLink,
                        infoHash: infoHash,
                        mainFileSize: sizeBytes,
                        seeders: seeders,
                        leechers: leechers,  
                        pubDate: item.pubDate || new Date().toISOString(),
                        source: 'TorrentDownload',
                        isMovie: isMovie
                    };
                } catch (error) {
                    console.error(`❌ Error processing item ${index}:`, error);
                    return null;
                }
            });
            
            // Filter out null results
            const validTorrents = torrents.filter(Boolean);
            
            console.log(`📊 Processing summary:`);
            console.log(`   - Total items processed: ${processedCount}`);
            console.log(`   - Movies detected: ${movieCount}`);
            console.log(`   - TV shows detected: ${tvCount}`);
            console.log(`   - Filtered out (size): ${filteredOutCount}`);
            console.log(`   - Valid torrents: ${validTorrents.length}`);
            
            // Count final results by type
            const finalMovies = validTorrents.filter(t => t.isMovie).length;
            const finalTV = validTorrents.filter(t => !t.isMovie).length;
            console.log(`   - Final movies: ${finalMovies}`);
            console.log(`   - Final TV shows: ${finalTV}`);
            
            // Sort by quality and seeders
            validTorrents.sort((a, b) => {
                const qualityOrder = { 
                    '2160p': 5, '4k': 5, 'uhd': 5,
                    '1080p': 4,
                    '720p': 3,
                    '480p': 2,
                    'webrip': 1,
                    'hdtv': 1
                };
                
                const aQuality = qualityOrder[a.quality] || 0;
                const bQuality = qualityOrder[b.quality] || 0;
                
                if (bQuality !== aQuality) return bQuality - aQuality;
                if (b.seeders !== a.seeders) return b.seeders - a.seeders;
                return b.mainFileSize - a.mainFileSize;
            });
            
            console.log(`✅ TorrentDownload: Returning ${validTorrents.length} valid torrents`);
            
            // Log sample of final results
            if (validTorrents.length > 0) {
                console.log(`📋 Sample final result:`, {
                    title: validTorrents[0].websiteTitle,
                    quality: validTorrents[0].quality,
                    size: validTorrents[0].size,
                    seeders: validTorrents[0].seeders,
                    isMovie: validTorrents[0].isMovie
                });
            }
            
            return validTorrents;
            
        } catch (error) {
            console.log(`⚠️ TorrentDownload attempt ${urlIndex + 1} failed:`, error.message);
            // If it's an XML parsing error, let's try to show more context
            if (error.message.includes('Invalid character') || error.message.includes('Line:')) {
                console.log(`📄 First 1000 chars of problematic RSS data:`, rssData?.substring(0, 1000));
                
                // Try a more aggressive cleaning approach
                try {
                    console.log(`🔧 Attempting aggressive XML cleaning...`);
                    let aggressiveClean = rssData
                        // Remove everything that's not basic XML structure and content
                        .replace(/<script[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[\s\S]*?<\/style>/gi, '')
                        // Fix all HTML entities to XML-safe versions
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        // Then restore XML tags we actually need
                        .replace(/&lt;(\/?(?:rss|channel|item|title|link|description|pubDate)[^&]*?)&gt;/gi, '<$1>')
                        // Remove any remaining control characters
                        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
                    
                    const aggressiveResult = await parser.parseStringPromise(aggressiveClean);
                    if (aggressiveResult?.rss?.channel?.item) {
                        console.log(`✅ Aggressive cleaning worked! Found ${Array.isArray(aggressiveResult.rss.channel.item) ? aggressiveResult.rss.channel.item.length : 1} items`);
                        // Use the aggressively cleaned result
                        const items = Array.isArray(aggressiveResult.rss.channel.item) 
                            ? aggressiveResult.rss.channel.item 
                            : [aggressiveResult.rss.channel.item];
                        
                        // Continue with the same processing logic...
                        console.log(`📦 TorrentDownload: Found ${items.length} items via aggressive cleaning`);
                        // ... rest of processing would go here
                    }
                } catch (aggressiveError) {
                    console.log(`❌ Even aggressive cleaning failed:`, aggressiveError.message);
                }
            }
        }
    }
    
    console.log(`❌ All TorrentDownload attempts failed`);
    return [];
}

export { fetchRSSFeeds };