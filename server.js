const http = require('http');
const https = require('https'); 
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// Simple CORS headers
function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Simple HTTP/HTTPS client using built-in modules
function httpGet(urlString) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(urlString);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        };

        const lib = parsedUrl.protocol === 'https:' ? https : http;
        
        const req = lib.request(options, (res) => {
            let data = '';
            
            res.on('data', chunk => {
                data += chunk;
            });
            
            res.on('end', () => {
                console.log(`Response from ${urlString}: ${res.statusCode}`);
                console.log(`Response data length: ${data.length}`);
                
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } catch (e) {
                        console.log('Failed to parse JSON, returning raw data');
                        resolve({ raw: data });
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (error) => {
            console.error(`Request error for ${urlString}:`, error.message);
            reject(error);
        });
        
        req.setTimeout(15000, () => {
            console.log(`Request timeout for ${urlString}`);
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

// Get MIME type for files
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
    setCorsHeaders(res);
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    try {
        // API Routes
        if (pathname.startsWith('/api/search/')) {
            const pathParts = pathname.split('/');
            if (pathParts.length >= 5) {
                const artist = decodeURIComponent(pathParts[3]);
                const song = decodeURIComponent(pathParts[4]);
                
                console.log(`Searching for: ${artist} - ${song}`);
                
                const result = {
                    success: true,
                    artist: artist,
                    song: song,
                    lyrics: null,
                    artistInfo: null
                };

                try {
                    // Try to fetch lyrics
                    const lyricsUrl = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(song)}`;
                    console.log(`Fetching lyrics from: ${lyricsUrl}`);
                    
                    const lyricsData = await httpGet(lyricsUrl);
                    console.log('Lyrics response:', lyricsData ? 'received' : 'empty');
                    
                    if (lyricsData && lyricsData.lyrics) {
                        result.lyrics = lyricsData.lyrics;
                        console.log(`Lyrics found, length: ${lyricsData.lyrics.length}`);
                    }
                } catch (e) {
                    console.log('Lyrics fetch error:', e.message);
                }

                try {
                    // Try to fetch artist info
                    const artistUrl = `https://theaudiodb.com/api/v1/json/1/search.php?s=${encodeURIComponent(artist)}`;
                    console.log(`Fetching artist info from: ${artistUrl}`);
                    
                    const artistData = await httpGet(artistUrl);
                    console.log('Artist response:', artistData ? 'received' : 'empty');
                    
                    if (artistData && artistData.artists && artistData.artists.length > 0) {
                        const artistInfo = artistData.artists[0];
                        result.artistInfo = {
                            name: artistInfo.strArtist,
                            biography: artistInfo.strBiographyEN || artistInfo.strBiography || 'No biography available.',
                            image: artistInfo.strArtistThumb || artistInfo.strArtistLogo,
                            genre: artistInfo.strGenre,
                            country: artistInfo.strCountry,
                            formed: artistInfo.intFormedYear,
                            website: artistInfo.strWebsite
                        };
                        console.log(`Artist info found for: ${artistInfo.strArtist}`);
                    }
                } catch (e) {
                    console.log('Artist info fetch error:', e.message);
                }

                // If neither lyrics nor artist info found, still return success with available data
                console.log(`Final result - Lyrics: ${result.lyrics ? 'YES' : 'NO'}, Artist Info: ${result.artistInfo ? 'YES' : 'NO'}`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid API path' }));
            }
        }
        // Health check
        else if (pathname === '/api/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'OK', message: 'Server is running' }));
        }
        // Serve static files
        else {
            let filePath = pathname === '/' ? '/index.html' : pathname;
            filePath = path.join(__dirname, 'public', filePath);
            
            // Security check - prevent directory traversal
            if (!filePath.startsWith(path.join(__dirname, 'public'))) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }

            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                const mimeType = getMimeType(filePath);
                res.writeHead(200, { 'Content-Type': mimeType });
                fs.createReadStream(filePath).pipe(res);
            } else {
                res.writeHead(404);
                res.end('File not found');
            }
        }
    } catch (error) {
        console.error('Server error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
});

// Start server
server.listen(PORT, () => {
    console.log(`🎵 Music Explorer Server running on port ${PORT}`);
    console.log(`📁 Serving static files from 'public' directory`);
    console.log(`🌐 Access the app at: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Server shutting down gracefully...');
    server.close(() => {
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Server shutting down gracefully...');
    server.close(() => {
        process.exit(0);
    });
});