# SSL Certificate Setup

This directory should contain your SSL/TLS certificates for HTTPS.

## Required Files

- `cert.pem` - SSL certificate file
- `key.pem` - Private key file
- `chain.pem` - Certificate chain (optional)

## Generating Self-Signed Certificate (Development Only)

For development purposes, you can generate a self-signed certificate:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout key.pem \
  -out cert.pem \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
```

## Production Certificates

For production, use certificates from a trusted Certificate Authority (CA):

### Using Let's Encrypt (Recommended)

```bash
# Install certbot
sudo apt-get install certbot

# Generate certificate
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ./cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ./key.pem
```

### Using Other CA

1. Purchase SSL certificate from a trusted CA
2. Download the certificate and private key
3. Place them in this directory as `cert.pem` and `key.pem`

## File Permissions

Ensure proper permissions for security:

```bash
chmod 600 key.pem
chmod 644 cert.pem
```

## Security Notes

- Never commit actual certificate files to version control
- This directory is included in `.gitignore`
- Rotate certificates before expiration
- Use strong encryption algorithms (RSA 2048+ or ECC)
