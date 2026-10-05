# SSL/TLS Certificate Directory for Nginx

This folder is mounted into the nginx container at `/etc/nginx/ssl`.

## Required File Names

The production nginx config expects:

- `gacp.crt` (full certificate chain)
- `gacp.key` (private key)

## Important Go-Live Rule

A public certificate authority (for example Let's Encrypt) **will not issue a trusted certificate for a raw public IP**.
For go-live, use a real domain (for example `gacp.example.go.th`) and point DNS to the server first.

## Production (Let's Encrypt) Example

```bash
sudo certbot certonly --standalone \
  -d gacp.example.go.th \
  --email admin@example.go.th \
  --agree-tos --non-interactive

sudo cp /etc/letsencrypt/live/gacp.example.go.th/fullchain.pem ./gacp.crt
sudo cp /etc/letsencrypt/live/gacp.example.go.th/privkey.pem ./gacp.key
sudo chmod 600 ./gacp.key
sudo chmod 644 ./gacp.crt
```

## Development (Self-Signed)

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout gacp.key \
  -out gacp.crt \
  -subj "/C=TH/ST=Bangkok/L=Bangkok/O=DTAM/CN=localhost"
```

## Security Notes

- Never commit `gacp.crt` or `gacp.key` to Git.
- Rotate certificates before expiry.
- Restrict private key permissions to root/admin only.
