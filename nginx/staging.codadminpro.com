# HTTP - Redirect to HTTPS
server {
     listen 80;
     server_name staging.codadminpro.com;
     return 301 https://$server_name$request_uri;
}

# HTTPS - Staging Application
server {
     listen 443 ssl http2;
     server_name staging.codadminpro.com;

# SSL certificates (Cloudflare handles SSL, but these are for origin)
ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;

# Security headers
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;

# Frontend (React app)
location / {
     proxy_pass http://localhost:8080;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection 'upgrade';
     proxy_set_header Host $host;
     proxy_set_header X-Real-IP $remote_addr;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_set_header X-Forwarded-Proto $scheme;
     proxy_cache_bypass $http_upgrade;
}

# Backend API
location /api {
     proxy_pass http://localhost:3001;
     proxy_http_version 1.1;
     proxy_set_header Host $host;
     proxy_set_header X-Real-IP $remote_addr;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_set_header X-Forwarded-Proto $scheme;
}

# WebSocket (Socket.io)
location /socket.io {
     proxy_pass http://localhost:3001;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_set_header Host $host;
     proxy_set_header X-Real-IP $remote_addr;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

# Health check endpoint
location /health {
     proxy_pass http://localhost:8080/health;
     access_log off;
}