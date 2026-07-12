const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;

// Function to get Local IP Address
function getLocalIp() {
    if (process.env.LAN_IP) {
        return process.env.LAN_IP;
    }
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            // Node 18+ uses 4 or 6, older versions use 'IPv4' or 'IPv6'
            const isIpv4 = alias.family === 'IPv4' || alias.family === 4;
            if (isIpv4 && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'localhost';
}

const server = http.createServer((req, res) => {
    // API endpoint for config
    if (req.url === '/api/config') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            ip: getLocalIp(),
            agraPort: 5000,
            notingPort: 5001
        }));
    }

    // API endpoint for translation (Proxy to Noting Builder on Port 5001)
    if (req.url === '/api/translate' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const notingUrl = `http://127.0.0.1:5001/api/translate`;
            
            const proxyReq = http.request(notingUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                }
            }, (proxyRes) => {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(res);
            });
            
            proxyReq.on('error', (e) => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to connect to Noting Builder translation API: ' + e.message }));
            });
            
            proxyReq.write(body);
            proxyReq.end();
        });
        return;
    }

    // Static file serving
    let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
    const extname = path.extname(filePath);
    let contentType = 'text/html';

    switch (extname) {
        case '.js': contentType = 'text/javascript'; break;
        case '.css': contentType = 'text/css'; break;
        case '.json': contentType = 'application/json'; break;
        case '.png': contentType = 'image/png'; break;
        case '.jpg': contentType = 'image/jpg'; break;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File Not Found');
            } else {
                res.writeHead(500);
                res.end('Server Error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    const ip = getLocalIp();
    console.log(`\n======================================================`);
    console.log(`🚀 AEROFORM SUITE PORTAL RUNNING`);
    console.log(`======================================================`);
    console.log(`\nLocal Access: http://localhost:${PORT}`);
    console.log(`LAN Access:   http://${ip}:${PORT}`);
    console.log(`\nDistribute the LAN Access URL to other computers.`);
    console.log(`======================================================\n`);
});
