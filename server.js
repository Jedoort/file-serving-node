const http = require('http');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const formidable = require('formidable');

const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');

// Whitelist of allowed file types (extension -> expected MIME type)
const ALLOWED_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// Make sure the uploads folder exists before the server starts accepting requests
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function sendJSON(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function serveStaticFile(req, res) {
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);

  // Prevent path traversal outside the public folder (e.g. /../server.js)
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    return res.end('<h1>403 - Forbidden</h1>');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 - File Not Found</h1>');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': mime.lookup(filePath) || 'application/octet-stream' });
      res.end(content, 'utf-8');
    }
  });
}

function handleUpload(req, res) {
  const form = new formidable.IncomingForm({
    uploadDir: UPLOAD_DIR,
    keepExtensions: true,
    maxFileSize: MAX_FILE_SIZE,
  });

  form.parse(req, (err, fields, files) => {
    if (err) {
      // formidable throws this when maxFileSize is exceeded
      if (err.code === 1009 || /maxFileSize/i.test(err.message)) {
        return sendJSON(res, 413, { error: 'File exceeds the 5MB size limit.' });
      }
      return sendJSON(res, 500, { error: 'Upload failed.', details: err.message });
    }

    const uploaded = files.file;
    const file = Array.isArray(uploaded) ? uploaded[0] : uploaded;

    if (!file) {
      return sendJSON(res, 400, { error: 'No file was provided. Use the "file" field.' });
    }

    const originalName = file.originalFilename || file.newFilename;
    const ext = path.extname(originalName).toLowerCase();
    const expectedMime = ALLOWED_TYPES[ext];

    // Validate extension AND that the reported MIME type matches the extension
    if (!expectedMime || file.mimetype !== expectedMime) {
      fs.unlink(file.filepath, () => {});
      return sendJSON(res, 400, {
        error: `File type not allowed. Accepted types: ${Object.keys(ALLOWED_TYPES).join(', ')}`,
      });
    }

    // Rename from formidable's random temp name to a sanitized version of the original name
    const safeName = `${Date.now()}-${originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const destPath = path.join(UPLOAD_DIR, safeName);

    fs.rename(file.filepath, destPath, (renameErr) => {
      if (renameErr) {
        return sendJSON(res, 500, { error: 'Could not save file.', details: renameErr.code });
      }
      sendJSON(res, 201, {
        message: 'File uploaded successfully.',
        fileName: safeName,
        url: `/uploads/${safeName}`,
      });
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/upload') {
    return handleUpload(req, res);
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStaticFile(req, res);
  }
  res.writeHead(405, { 'Content-Type': 'text/html' });
  res.end('<h1>405 - Method Not Allowed</h1>');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));