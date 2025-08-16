import express from 'express';
import { PM } from './pm.js';

// Static imports for bundling
import { fetchRSSFeeds as torrentdownloadFetcher } from './tdownload.js';

const app = express();
const port = process.env.PORT || 7000;
const TMDB_API_KEY = 'f051e7366c6105ad4f9aafe4733d9dae';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Configuration for different scrapers
const SCRAPER_CONFIGS = {
    torrentdownload: {
        name: 'TorrentDownload + Premiumize',
        id: 'com.torrentdownload.premiumize',
        description: 'Cached torrents from TorrentDownload via Premiumize',
        scraperModule: './tdownload.js'
    }
};

// Scraper mapping
const SCRAPER_FUNCTIONS = {
    torrentdownload: torrentdownloadFetcher
};

// Get scraper type from environment or default to torrentdownload
const SCRAPER_TYPE = process.env.SCRAPER_TYPE || 'torrentdownload';
const config = SCRAPER_CONFIGS[SCRAPER_TYPE];

if (!config) {
    console.error(`❌ Unknown scraper type: ${SCRAPER_TYPE}`);
    console.error(`Available scrapers: ${Object.keys(SCRAPER_CONFIGS).join(', ')}`);
    process.exit(1);
}

// Get the scraper function
const fetchRSSFeeds = SCRAPER_FUNCTIONS[SCRAPER_TYPE];

if (!fetchRSSFeeds) {
    console.error(`❌ No scraper function found for: ${SCRAPER_TYPE}`);
    process.exit(1);
}

console.log(`✅ Loaded scraper: ${config.name}`);

// Add JSON parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    
    next();
});

// Add request logging middleware
app.use((req, res, next) => {
    console.log(`${req.method} ${req.originalUrl} - ${new Date().toISOString()}`);
    next();
});

// Dynamic manifest based on scraper config
const MANIFEST = {
    id: config.id,
    version: '1.0.0',
    name: config.name,
    description: config.description,
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    behaviorHints: {
        configurable: true,
        configurationRequired: false
    }
};

// Helper functions
function getQualitySymbol(quality) {
    if (!quality) return '🎬';
    const q = quality.toLowerCase();
    
    if (q.includes('2160') || q.includes('4k') || q.includes('uhd')) return '🔥';
    if (q.includes('1080')) return '⭐';
    if (q.includes('720')) return '✅';
    if (q.includes('480')) return '📺';
    return '🎬';
}

function extractImdbId(id) {
    if (id.startsWith('tt')) return id;
    if (id.match(/^\d+$/)) return `tt${id}`;
    return null;
}

async function getTMDBDetails(imdbId) {
    try {
        const response = await fetch(`${TMDB_BASE_URL}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
        if (!response.ok) {
            console.log(`TMDB API error: ${response.status} ${response.statusText}`);
            return null;
        }
        const data = await response.json();
        
        if (data.movie_results?.[0]) {
            const movie = data.movie_results[0];
            const year = new Date(movie.release_date).getFullYear();
            return {
                title: movie.title,
                year: year,
                type: 'movie'
            };
        }
        
        if (data.tv_results?.[0]) {
            const show = data.tv_results[0];
            const year = new Date(show.first_air_date).getFullYear();
            return {
                title: show.name,
                year: year,
                type: 'series'
            };
        }
        
        return null;
    } catch (error) {
        console.error('TMDB fetch error:', error);
        return null;
    }
}

// Root endpoint with instructions
app.get('/', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.send(`
        <h1>${config.name} Stremio Addon</h1>
        <p><strong>Active Scraper:</strong> ${SCRAPER_TYPE}</p>
        <p>Add this addon to Stremio using:</p>
        <p><code>${baseUrl}/manifest.json</code></p>
        <p>Endpoints:</p>
        <ul>
            <li><a href="/manifest.json">Manifest</a></li>
            <li><a href="/stream/movie/tt0111161.json">Example Movie Stream (The Shawshank Redemption)</a></li>
            <li><a href="/stream/series/tt0944947:1:1.json">Example Series Stream (Game of Thrones S01E01)</a></li>
        </ul>
        <p>Server Status: ✅ Running</p>
        <p>Current Time: ${new Date().toISOString()}</p>
        <hr>
        <h3>Available Scrapers:</h3>
        <ul>
            ${Object.keys(SCRAPER_CONFIGS).map(key => 
                `<li><strong>${key}</strong>: ${SCRAPER_CONFIGS[key].description}</li>`
            ).join('')}
        </ul>
        <p><em>Set SCRAPER_TYPE environment variable to switch scrapers</em></p>
        <p><strong>Examples:</strong></p>
        <ul>
            <li><code>SCRAPER_TYPE=torrentdownload node server.js</code></li>
        </ul>
    `);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        scraper: SCRAPER_TYPE,
        config: config.name,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Stremio manifest endpoint
app.get('/manifest.json', (req, res) => {
    console.log(`📋 Manifest requested for ${config.name}`);
    res.setHeader('Content-Type', 'application/json');
    res.json(MANIFEST);
});

// Alternative manifest endpoint for compatibility
app.get('/manifest', (req, res) => {
    console.log(`📋 Alternative manifest requested for ${config.name}`);
    res.setHeader('Content-Type', 'application/json');
    res.json(MANIFEST);
});

// Stremio stream endpoint - flexible routing
app.get('/stream/:type/:id', async (req, res) => {
    try {
        const type = req.params.type; // movie or series
        let id = req.params.id; // tt123456 or tt123456:1:1 or tt123456.json
        
        // Remove .json extension if present
        if (id.endsWith('.json')) {
            id = id.slice(0, -5);
        }
        
        console.log(`🎯 ${config.name} stream request: type=${type}, id=${id}`);
        
        // Validate type
        if (!['movie', 'series'].includes(type)) {
            console.log(`❌ Invalid type: ${type}`);
            return res.status(400).json({ error: 'Invalid type. Must be movie or series.' });
        }
        
        // Extract base IMDB ID
        const imdbId = id.split(':')[0];
        const baseImdbId = extractImdbId(imdbId);
        
        if (!baseImdbId) {
            console.log(`❌ Invalid IMDB ID: ${imdbId}`);
            return res.status(400).json({ error: 'Invalid IMDB ID format' });
        }

        console.log(`🎬 Processing: ${type} with IMDB ID: ${baseImdbId}`);

        // Get media details from TMDB
        const mediaDetails = await getTMDBDetails(baseImdbId);
        if (!mediaDetails) {
            console.log(`❌ No TMDB details found for: ${baseImdbId}`);
            return res.json({ streams: [] });
        }

        console.log(`✅ Found media: ${mediaDetails.title} (${mediaDetails.year})`);

        // Prepare search query
        let searchQuery = `${mediaDetails.title} (${mediaDetails.year})`;
        
        // For series, handle season/episode
        if (type === 'series' && id.includes(':')) {
            const parts = id.split(':');
            if (parts.length >= 3) {
                const season = parts[1].padStart(2, '0');
                const episode = parts[2].padStart(2, '0');
                searchQuery = `${mediaDetails.title} S${season}E${episode}`;
            }
        }

        console.log(`🔍 Searching ${SCRAPER_TYPE} for: "${searchQuery}"`);
        
        // Fetch torrents using the loaded scraper
        const torrents = await fetchRSSFeeds(searchQuery, type);
        console.log(`🔍 Found ${torrents.length} torrents from ${SCRAPER_TYPE}`);
        
        if (torrents.length === 0) {
            return res.json({ streams: [] });
        }

        // Check cache status with Premiumize
        const hashes = torrents.map(t => t.infoHash).filter(Boolean);
        if (hashes.length === 0) {
            console.log('❌ No valid hashes found in torrents');
            return res.json({ streams: [] });
        }

        console.log(`🔍 Checking cache for ${hashes.length} hashes`);
        const cacheChecks = await Promise.all(
            hashes.map(hash => PM.checkCached(hash).catch(err => {
                console.error(`Cache check failed for ${hash}:`, err);
                return false;
            }))
        );
        
        const cacheResults = {};
        hashes.forEach((hash, i) => {
            cacheResults[hash] = cacheChecks[i];
        });

        // Get direct links for cached torrents
        const cachedTorrents = torrents.filter(t => 
            t.infoHash && cacheResults[t.infoHash]
        );

        console.log(`⚡ Found ${cachedTorrents.length} cached torrents`);
        
        if (cachedTorrents.length === 0) {
            return res.json({ streams: [] });
        }
        
        // Create streams
        const streams = await Promise.all(
            cachedTorrents.slice(0, 10).map(async (torrent) => {
                try {
                    // Get direct links from Premiumize
                    const directLinks = await PM.getDirectDl(torrent.infoHash);
                    if (!directLinks || directLinks.length === 0) {
                        console.log(`No direct links for hash: ${torrent.infoHash}`);
                        return null;
                    }
                    
                    // Find the best video file
                    const bestFile = directLinks.reduce((best, current) => {
                        const isVideo = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i.test(current.path);
                        if (!isVideo) return best;
                        
                        if (!best || current.size > best.size) return current;
                        return best;
                    }, null);
                    
                    if (!bestFile || !bestFile.link) {
                        console.log(`No suitable video file found for: ${torrent.websiteTitle}`);
                        return null;
                    }
                    
                    const quality = torrent.quality || '';
                    const qualitySymbol = getQualitySymbol(quality);
                    const size = torrent.size ? ` (${torrent.size})` : '';
                    const sourceName = SCRAPER_TYPE.charAt(0).toUpperCase() + SCRAPER_TYPE.slice(1);
                    
                    return {
                        name: `${qualitySymbol} ${quality.toUpperCase()}${size} | ${sourceName}+`,
                        title: `${torrent.websiteTitle}\n⚡ Cached on Premiumize`,
                        url: bestFile.link,
                        behaviorHints: {
                            bingeGroup: `${SCRAPER_TYPE}-${baseImdbId}`,
                            notWebReady: false
                        }
                    };
                } catch (error) {
                    console.error('Error processing torrent:', error);
                    return null;
                }
            })
        );
        
        const validStreams = streams.filter(Boolean);
        console.log(`✅ Returning ${validStreams.length} valid streams`);
        
        res.setHeader('Content-Type', 'application/json');
        res.json({ streams: validStreams });
        
    } catch (error) {
        console.error('Stream endpoint error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// Also handle the .json extension explicitly
app.get('/stream/:type/:id.json', (req, res) => {
    // Redirect to the main stream handler without .json
    req.url = req.url.replace('.json', '');
    app._router.handle(req, res);
});

// Debug endpoint to test routing
app.get('/debug/:path*?', (req, res) => {
    res.json({
        scraper: SCRAPER_TYPE,
        config: config.name,
        originalUrl: req.originalUrl,
        path: req.path,
        params: req.params,
        query: req.query,
        method: req.method,
        headers: req.headers
    });
});

// Handle all other routes with a proper 404 response
app.use('*', (req, res) => {
    console.log(`❌ 404 - Route not found: ${req.method} ${req.originalUrl}`);
    
    // Send JSON response for API requests
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
        res.status(404).json({ 
            error: 'Route not found',
            scraper: SCRAPER_TYPE,
            path: req.originalUrl,
            availableEndpoints: [
                'GET /',
                'GET /health',
                'GET /manifest.json',
                'GET /manifest',
                'GET /stream/:type/:id',
                'GET /stream/:type/:id.json'
            ]
        });
        return;
    }
    
    // Send HTML response for browser requests
    res.status(404).send(`
        <h1>404 - Page Not Found</h1>
        <p><strong>Active Scraper:</strong> ${config.name}</p>
        <p><strong>Requested:</strong> ${req.method} ${req.originalUrl}</p>
        <p><strong>Valid endpoints:</strong></p>
        <ul>
            <li><a href="/">Home</a></li>
            <li><a href="/health">Health Check</a></li>
            <li><a href="/manifest.json">Manifest</a></li>
            <li><a href="/stream/movie/tt0111161">Example Movie Stream</a></li>
            <li><a href="/stream/series/tt0944947:1:1">Example Series Stream</a></li>
        </ul>
        <p><a href="/">← Back to Home</a></p>
    `);
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        scraper: SCRAPER_TYPE,
        message: error.message,
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(port, () => {
    console.log('🚀 Server starting...');
    console.log(`📡 ${config.name} addon running at http://localhost:${port}`);
    console.log(`🔧 Active scraper: ${SCRAPER_TYPE}`);
    console.log(`📋 Manifest URL: http://localhost:${port}/manifest.json`);
    console.log(`🎬 Test movie stream: http://localhost:${port}/stream/movie/tt0111161.json`);
    console.log(`📺 Test series stream: http://localhost:${port}/stream/series/tt0944947:1:1.json`);
    console.log(`🏠 Home page: http://localhost:${port}/`);
    console.log(`💚 Health check: http://localhost:${port}/health`);
    console.log('✅ Server ready!');
});